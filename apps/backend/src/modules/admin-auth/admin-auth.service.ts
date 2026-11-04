import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { randomBytes } from 'node:crypto';
import { AppError } from '../../common/errors';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/env';
import { DATABASE } from '../../database/database.module';
import type { AdminRole, DB } from '../../database/types';
import { AuditService } from '../audit/audit.service';
import { sha256Hex } from '../auth/tokens';
import { decryptSecret, DUMMY_PASSWORD_HASH, matchTotp, verifyPassword } from './crypto';
import { type Permission, permissionsFor } from './permissions';

export const MAX_FAILED_LOGINS = 10;
export const LOCKOUT_MINUTES = 15;

export interface AdminPrincipal {
  id: string;
  email: string;
  fullName: string;
  roles: AdminRole[];
  permissions: Set<Permission>;
  sessionId: string;
}

/**
 * Admin login: email + password + TOTP code, all three required every time.
 * Any failure gives the same generic error so attackers can't learn which part was wrong.
 */
@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly audit: AuditService,
  ) {}

  async login(
    email: string,
    password: string,
    totp: string,
    ip: string | null,
    userAgent: string | null,
  ): Promise<{ sessionToken: string; csrfToken: string; expiresAt: Date }> {
    const failed = () =>
      new AppError(
        HttpStatus.UNAUTHORIZED,
        'ADMIN_LOGIN_FAILED',
        'Email, password or code is incorrect.',
      );

    const admin = await this.db
      .selectFrom('admin_users')
      .selectAll()
      .where('email', '=', email.toLowerCase())
      .executeTakeFirst();

    // Always run the expensive password check so response time doesn't reveal valid emails.
    const passwordOk = await verifyPassword(password, admin?.password_hash ?? DUMMY_PASSWORD_HASH);
    if (!admin) throw failed();

    if (admin.status !== 'active') throw failed();
    if (admin.locked_until && new Date(admin.locked_until).getTime() > Date.now()) {
      throw new AppError(
        HttpStatus.TOO_MANY_REQUESTS,
        'ADMIN_LOCKED',
        'Too many failed attempts. Try again later.',
      );
    }

    let step: number | null = null;
    if (passwordOk && admin.mfa_enabled && admin.totp_secret_enc) {
      const secret = decryptSecret(admin.totp_secret_enc, this.config.ADMIN_TOTP_ENCRYPTION_KEY);
      step = matchTotp(secret, totp);
      // Reject a code from a step that was already used (replay).
      if (step !== null && admin.totp_last_step !== null && step <= Number(admin.totp_last_step)) {
        step = null;
      }
    }

    if (!passwordOk || step === null) {
      const failures = admin.failed_login_count + 1;
      await this.db.transaction().execute(async (trx) => {
        await trx
          .updateTable('admin_users')
          .set({
            failed_login_count: failures >= MAX_FAILED_LOGINS ? 0 : failures,
            ...(failures >= MAX_FAILED_LOGINS
              ? { locked_until: sql`now() + make_interval(mins => ${LOCKOUT_MINUTES})` }
              : {}),
          })
          .where('id', '=', admin.id)
          .execute();
        await this.audit.record(trx, {
          actorType: 'admin',
          actorId: admin.id,
          action: failures >= MAX_FAILED_LOGINS ? 'admin.locked' : 'admin.login_failed',
          entityType: 'admin_user',
          entityId: admin.id,
          ip,
        });
      });
      throw failed();
    }

    const sessionToken = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.config.ADMIN_SESSION_HOURS * 3_600_000);

    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('admin_users')
        .set({
          failed_login_count: 0,
          locked_until: null,
          last_login_at: sql`now()`,
          totp_last_step: step,
        })
        .where('id', '=', admin.id)
        .execute();
      await trx
        .insertInto('admin_sessions')
        .values({
          admin_user_id: admin.id,
          token_hash: sha256Hex(sessionToken),
          csrf_token_hash: sha256Hex(csrfToken),
          ip,
          user_agent: userAgent?.slice(0, 300) ?? null,
          expires_at: expiresAt,
          revoked_at: null,
        })
        .execute();
      await this.audit.record(trx, {
        actorType: 'admin',
        actorId: admin.id,
        action: 'admin.login',
        entityType: 'admin_user',
        entityId: admin.id,
        ip,
      });
    });

    return { sessionToken, csrfToken, expiresAt };
  }

  /** Resolves a session cookie to an admin. Enforces absolute expiry and idle timeout. */
  async authenticate(
    sessionToken: string,
  ): Promise<(AdminPrincipal & { csrfHash: string }) | null> {
    if (!sessionToken || sessionToken.length > 100) return null;
    const row = await this.db
      .selectFrom('admin_sessions as s')
      .innerJoin('admin_users as a', 'a.id', 's.admin_user_id')
      .select([
        's.id as sessionId',
        's.csrf_token_hash',
        's.expires_at',
        's.last_seen_at',
        's.revoked_at',
        'a.id',
        'a.email',
        'a.full_name',
        'a.status',
      ])
      .where('s.token_hash', '=', sha256Hex(sessionToken))
      .executeTakeFirst();
    if (!row || row.revoked_at || row.status !== 'active') return null;

    const now = Date.now();
    const idleLimit = this.config.ADMIN_IDLE_MINUTES * 60_000;
    if (
      new Date(row.expires_at).getTime() <= now ||
      now - new Date(row.last_seen_at).getTime() > idleLimit
    ) {
      await this.revoke(row.sessionId);
      return null;
    }

    const roles = (
      await this.db
        .selectFrom('admin_roles')
        .select('role')
        .where('admin_user_id', '=', row.id)
        .execute()
    ).map((r) => r.role);

    // Only refresh last_seen_at about once a minute to avoid a write on every request.
    if (now - new Date(row.last_seen_at).getTime() > 60_000) {
      await this.db
        .updateTable('admin_sessions')
        .set({ last_seen_at: sql`now()` })
        .where('id', '=', row.sessionId)
        .execute();
    }

    return {
      id: row.id,
      email: row.email,
      fullName: row.full_name,
      roles,
      permissions: permissionsFor(roles),
      sessionId: row.sessionId,
      csrfHash: row.csrf_token_hash,
    };
  }

  async revoke(sessionId: string): Promise<void> {
    await this.db
      .updateTable('admin_sessions')
      .set({ revoked_at: sql`now()` })
      .where('id', '=', sessionId)
      .where('revoked_at', 'is', null)
      .execute();
  }

  /** Ends every session of an admin, e.g. when they are disabled or their roles change. */
  async revokeAllFor(adminId: string): Promise<void> {
    await this.db
      .updateTable('admin_sessions')
      .set({ revoked_at: sql`now()` })
      .where('admin_user_id', '=', adminId)
      .where('revoked_at', 'is', null)
      .execute();
    this.logger.log({ adminId }, 'All sessions revoked for admin');
  }
}
