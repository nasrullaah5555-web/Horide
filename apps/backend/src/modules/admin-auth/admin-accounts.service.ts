import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Kysely, sql, Transaction } from 'kysely';
import { createHash, randomBytes } from 'node:crypto';
import { AppError } from '../../common/errors';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/env';
import { DATABASE } from '../../database/database.module';
import type { AdminRole, DB } from '../../database/types';
import { AuditService } from '../audit/audit.service';
import { encryptSecret, generateTotpSecret, hashPassword, otpauthUrl } from './crypto';

export interface NewAdminCredentials {
  id: string;
  email: string;
  temporaryPassword: string;
  totpSecret: string;
  otpauthUrl: string;
}

export const MIN_ADMIN_PASSWORD_LENGTH = 12;

/** Creating and managing admin accounts. Used by the API and by the create-admin CLI. */
@Injectable()
export class AdminAccountsService {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly audit: AuditService,
  ) {}

  /**
   * Creates an admin with a random temporary password and a TOTP secret.
   * Both are returned ONCE; only their hash / encrypted form is stored.
   */
  async create(
    input: { email: string; fullName: string; roles: AdminRole[] },
    actor: { id: string | null; ip?: string | null },
  ): Promise<NewAdminCredentials> {
    if (input.roles.length === 0) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'ROLES_REQUIRED',
        'Give the admin at least one role.',
      );
    }
    const temporaryPassword = randomBytes(15).toString('base64url'); // 20 characters
    const totpSecret = generateTotpSecret();
    const email = input.email.toLowerCase();

    const id = await this.db.transaction().execute(async (trx) => {
      const exists = await trx
        .selectFrom('admin_users')
        .select('id')
        .where('email', '=', email)
        .executeTakeFirst();
      if (exists) {
        throw new AppError(
          HttpStatus.CONFLICT,
          'ADMIN_EXISTS',
          'An admin with this email already exists.',
        );
      }
      const created = await trx
        .insertInto('admin_users')
        .values({
          email,
          full_name: input.fullName,
          password_hash: await hashPassword(temporaryPassword),
          totp_secret_enc: encryptSecret(totpSecret, this.config.ADMIN_TOTP_ENCRYPTION_KEY),
          mfa_enabled: true,
          locked_until: null,
          last_login_at: null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await this.setRolesInTrx(trx, created.id, input.roles, actor.id);
      await this.audit.record(trx, {
        actorType: actor.id ? 'admin' : 'system',
        actorId: actor.id,
        action: 'admin.created',
        entityType: 'admin_user',
        entityId: created.id,
        after: { email, fullName: input.fullName, roles: input.roles },
        ip: actor.ip ?? null,
      });
      return created.id;
    });

    return { id, email, temporaryPassword, totpSecret, otpauthUrl: otpauthUrl(totpSecret, email) };
  }

  /**
   * STAGING ONLY (see staging-admin.ts): gives an existing admin a new random temporary password,
   * unlocks the account and signs out every session. One-shot per `key`: a key already used is
   * ignored, so leaving the setting in place can't reset the password again on every restart.
   * Returns the new password ONCE, or null when the key was used before or there is no such admin.
   */
  async resetPasswordForStaging(email: string, key: string): Promise<string | null> {
    const keyHash = createHash('sha256').update(key).digest('hex');
    const temporaryPassword = randomBytes(15).toString('base64url'); // 20 characters
    return this.db.transaction().execute(async (trx) => {
      const used = await trx
        .selectFrom('audit_logs')
        .select('id')
        .where('action', '=', 'admin.password_reset_staging')
        .where(sql<string>`after->>'key'`, '=', keyHash)
        .executeTakeFirst();
      if (used) return null;
      const admin = await trx
        .updateTable('admin_users')
        .set({
          password_hash: await hashPassword(temporaryPassword),
          failed_login_count: 0,
          locked_until: null,
        })
        .where('email', '=', email.toLowerCase())
        .returning('id')
        .executeTakeFirst();
      if (!admin) return null;
      await trx
        .updateTable('admin_sessions')
        .set({ revoked_at: sql`now()` })
        .where('admin_user_id', '=', admin.id)
        .where('revoked_at', 'is', null)
        .execute();
      await this.audit.record(trx, {
        actorType: 'system',
        actorId: null,
        action: 'admin.password_reset_staging',
        entityType: 'admin_user',
        entityId: admin.id,
        after: { key: keyHash },
        ip: null,
      });
      return temporaryPassword;
    });
  }

  async setRoles(adminId: string, roles: AdminRole[], actor: { id: string; ip: string | null }) {
    // Owner decision (2026-11-06): a super admin may give themselves other roles, so a small team
    // can work from one account. Every change is in the audit log. Removing your own super role
    // is still refused, so the company can't be left with nobody able to manage staff.
    if (adminId === actor.id && !roles.includes('super')) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'CANNOT_REMOVE_OWN_SUPER',
        'You cannot remove your own super admin role.',
      );
    }
    await this.db.transaction().execute(async (trx) => {
      const before = await this.rolesOf(trx, adminId);
      await this.setRolesInTrx(trx, adminId, roles, actor.id);
      await this.audit.record(trx, {
        actorType: 'admin',
        actorId: actor.id,
        action: 'admin.roles_changed',
        entityType: 'admin_user',
        entityId: adminId,
        before: { roles: before },
        after: { roles },
        ip: actor.ip,
      });
    });
  }

  async setStatus(
    adminId: string,
    status: 'active' | 'disabled',
    actor: { id: string; ip: string | null },
  ) {
    if (adminId === actor.id) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'CANNOT_CHANGE_OWN_STATUS',
        'You cannot disable yourself.',
      );
    }
    await this.db.transaction().execute(async (trx) => {
      const updated = await trx
        .updateTable('admin_users')
        .set({ status })
        .where('id', '=', adminId)
        .returning('id')
        .executeTakeFirst();
      if (!updated) throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Admin not found.');
      await this.audit.record(trx, {
        actorType: 'admin',
        actorId: actor.id,
        action: status === 'disabled' ? 'admin.disabled' : 'admin.enabled',
        entityType: 'admin_user',
        entityId: adminId,
        ip: actor.ip,
      });
    });
  }

  private async rolesOf(trx: Transaction<DB>, adminId: string): Promise<AdminRole[]> {
    const rows = await trx
      .selectFrom('admin_roles')
      .select('role')
      .where('admin_user_id', '=', adminId)
      .execute();
    return rows.map((r) => r.role).sort();
  }

  private async setRolesInTrx(
    trx: Transaction<DB>,
    adminId: string,
    roles: AdminRole[],
    grantedBy: string | null,
  ) {
    const exists = await trx
      .selectFrom('admin_users')
      .select('id')
      .where('id', '=', adminId)
      .executeTakeFirst();
    if (!exists) throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Admin not found.');
    await trx.deleteFrom('admin_roles').where('admin_user_id', '=', adminId).execute();
    const unique = [...new Set(roles)];
    if (unique.length) {
      await trx
        .insertInto('admin_roles')
        .values(unique.map((role) => ({ admin_user_id: adminId, role, granted_by: grantedBy })))
        .execute();
    }
  }
}
