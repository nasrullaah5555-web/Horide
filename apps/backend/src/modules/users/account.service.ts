import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Kysely } from 'kysely';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../../common/errors';
import { DATABASE } from '../../database/database.module';
import type { DB } from '../../database/types';

/**
 * Account status checks for actions that change things (booking, going online, uploading).
 * Access tokens are valid for 15 minutes without a database lookup, so a suspension must be
 * checked here, at the moment of each important action.
 */
@Injectable()
export class AccountService {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    private readonly audit: AuditService,
  ) {}

  /**
   * Suspends or reinstates a passenger or driver account (admin action, audited, reason recorded).
   * A suspended driver is taken offline at once. Trips already under way are not interrupted.
   */
  async setStatus(
    admin: { id: string; ip: string | null },
    userId: string,
    role: 'driver' | 'passenger',
    status: 'active' | 'suspended',
    reason: string | null,
  ): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const before = await trx
        .selectFrom('users')
        .select(['status', 'suspended_reason'])
        .where('id', '=', userId)
        .where('role', '=', role)
        .forUpdate()
        .executeTakeFirst();
      if (!before || before.status === 'deleted') {
        throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Account not found.');
      }
      await trx
        .updateTable('users')
        .set({ status, suspended_reason: status === 'suspended' ? reason : null })
        .where('id', '=', userId)
        .execute();
      if (status === 'suspended' && role === 'driver') {
        await trx
          .updateTable('driver_locations')
          .set({ is_online: false })
          .where('driver_id', '=', userId)
          .execute();
      }
      await this.audit.record(trx, {
        actorType: 'admin',
        actorId: admin.id,
        action: status === 'suspended' ? `${role}.suspended` : `${role}.reinstated`,
        entityType: role,
        entityId: userId,
        before,
        after: { status, reason },
        ip: admin.ip,
      });
    });
  }

  async requireActive(userId: string): Promise<void> {
    const user = await this.db
      .selectFrom('users')
      .select(['status', 'suspended_reason'])
      .where('id', '=', userId)
      .executeTakeFirst();
    if (!user || user.status === 'deleted') {
      throw new AppError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Please log in.');
    }
    if (user.status === 'suspended') {
      throw new AppError(
        HttpStatus.FORBIDDEN,
        'ACCOUNT_SUSPENDED',
        'Your account is suspended. Contact Musride support.',
        { reason: user.suspended_reason },
      );
    }
  }
}
