import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { Kysely, sql, Transaction } from 'kysely';
import { randomUUID } from 'node:crypto';
import { AppError } from '../../common/errors';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/env';
import { DATABASE } from '../../database/database.module';
import type { DB, UserRole } from '../../database/types';
import { generateRefreshToken, sha256Hex, signAccessToken } from './tokens';

export interface IssuedTokens {
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

export interface LoginResult extends IssuedTokens {
  user: { id: string; role: UserRole; phone: string; status: string; isNew: boolean };
}

/**
 * Login sessions.
 * - Access token: short-lived (default 15 min), checked without a database lookup.
 * - Refresh token: long-lived, stored only as a hash, replaced on every use ("rotation").
 * - If an already-used refresh token is presented again, someone has copied it: the whole
 *   session family is revoked, logging out both the thief and the real user.
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Finds or creates the account for a verified phone and opens a new session. */
  async login(phone: string, role: UserRole, deviceInfo: string | null): Promise<LoginResult> {
    return this.db.transaction().execute(async (trx) => {
      const inserted = await trx
        .insertInto('users')
        .values({ phone, role, suspended_reason: null })
        .onConflict((oc) => oc.columns(['phone', 'role']).doNothing())
        .returning('id')
        .executeTakeFirst();

      const user = await trx
        .selectFrom('users')
        .select(['id', 'role', 'phone', 'status'])
        .where('phone', '=', phone)
        .where('role', '=', role)
        .executeTakeFirstOrThrow();

      if (user.status === 'deleted') {
        throw new AppError(
          HttpStatus.FORBIDDEN,
          'ACCOUNT_DELETED',
          'This account has been deleted. Contact Horide support.',
        );
      }

      if (inserted) {
        if (role === 'passenger') {
          await trx
            .insertInto('passenger_profiles')
            .values({ user_id: user.id, full_name: null, emergency_contact_phone: null })
            .execute();
        } else {
          await trx
            .insertInto('driver_profiles')
            .values({ user_id: user.id, full_name: null, approved_by: null, approved_at: null })
            .execute();
        }
      }

      const tokens = await this.openSession(trx, user.id, role, randomUUID(), deviceInfo);
      return { ...tokens, user: { ...user, phone, isNew: inserted !== undefined } };
    });
  }

  async refresh(refreshToken: string): Promise<IssuedTokens> {
    const unauthorized = () =>
      new AppError(HttpStatus.UNAUTHORIZED, 'SESSION_INVALID', 'Please log in again.');
    if (typeof refreshToken !== 'string' || refreshToken.length < 20 || refreshToken.length > 200) {
      throw unauthorized();
    }
    const hash = sha256Hex(refreshToken);

    const result = await this.db.transaction().execute(async (trx) => {
      const session = await trx
        .selectFrom('auth_sessions as s')
        .innerJoin('users as u', 'u.id', 's.user_id')
        .select([
          's.id',
          's.user_id',
          's.family_id',
          's.expires_at',
          's.revoked_at',
          's.device_info',
          'u.role',
          'u.status',
        ])
        .where('s.refresh_token_hash', '=', hash)
        .forUpdate('s')
        .executeTakeFirst();

      if (!session) return { ok: false as const };

      if (session.revoked_at !== null) {
        // Reuse of a rotated token: revoke the whole family. Committed, then reported as 401.
        await this.revokeFamily(trx, session.family_id);
        return { ok: false as const, reuse: true, userId: session.user_id };
      }
      if (new Date(session.expires_at).getTime() <= Date.now() || session.status === 'deleted') {
        return { ok: false as const };
      }

      const tokens = await this.openSession(
        trx,
        session.user_id,
        session.role,
        session.family_id,
        session.device_info,
        session.id,
      );
      return { ok: true as const, tokens };
    });

    if (!result.ok) {
      if ('reuse' in result) {
        this.logger.warn(
          { userId: result.userId },
          'Refresh token reuse detected; session family revoked',
        );
      }
      throw unauthorized();
    }
    return result.tokens;
  }

  /** Logs out every device sharing this session family. Unknown tokens are ignored silently. */
  async logout(refreshToken: string): Promise<void> {
    if (typeof refreshToken !== 'string' || refreshToken.length > 200) return;
    const session = await this.db
      .selectFrom('auth_sessions')
      .select('family_id')
      .where('refresh_token_hash', '=', sha256Hex(refreshToken))
      .executeTakeFirst();
    if (session) await this.revokeFamily(this.db, session.family_id);
  }

  private async revokeFamily(db: Kysely<DB> | Transaction<DB>, familyId: string): Promise<void> {
    await db
      .updateTable('auth_sessions')
      .set({ revoked_at: sql`now()` })
      .where('family_id', '=', familyId)
      .where('revoked_at', 'is', null)
      .execute();
  }

  private async openSession(
    trx: Transaction<DB>,
    userId: string,
    role: UserRole,
    familyId: string,
    deviceInfo: string | null,
    replacesSessionId?: string,
  ): Promise<IssuedTokens> {
    const refreshToken = generateRefreshToken();
    const refreshTokenExpiresAt = new Date(
      Date.now() + this.config.REFRESH_TOKEN_TTL_DAYS * 86_400_000,
    );
    const created = await trx
      .insertInto('auth_sessions')
      .values({
        user_id: userId,
        family_id: familyId,
        refresh_token_hash: sha256Hex(refreshToken),
        expires_at: refreshTokenExpiresAt,
        revoked_at: null,
        replaced_by: null,
        device_info: deviceInfo,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    if (replacesSessionId) {
      await trx
        .updateTable('auth_sessions')
        .set({ revoked_at: sql`now()`, replaced_by: created.id })
        .where('id', '=', replacesSessionId)
        .execute();
    }

    const access = signAccessToken(
      { sub: userId, role, sid: familyId },
      this.config.JWT_ACCESS_SECRET,
      this.config.ACCESS_TOKEN_TTL_SECONDS,
    );
    return {
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken,
      refreshTokenExpiresAt,
    };
  }
}
