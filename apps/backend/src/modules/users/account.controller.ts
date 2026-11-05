import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { Kysely, sql } from 'kysely';
import { z } from 'zod';
import { AppError } from '../../common/errors';
import { RateLimit } from '../../common/rate-limit';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { DATABASE } from '../../database/database.module';
import type { DB } from '../../database/types';
import { AuditService } from '../audit/audit.service';
import { type AuthUser, CurrentUser, Roles, UserAuthGuard } from '../auth/auth.guard';
import { STORAGE_PROVIDER, type StorageProvider } from '../storage/storage.provider';
import { OPEN_STATUSES } from '../trips/trip-state';

const deleteSchema = z.strictObject({ confirm: z.literal(true) });

/**
 * Account deletion, required by the app stores and by Ethiopia's data protection law
 * (Proclamation No. 1321/2024; SECURITY_PLAN §6).
 *
 * What is removed: phone number, name, emergency contact, saved places, sessions, push tokens,
 * notifications, live location and the driver's identity documents (files and records).
 * What is kept: trips, payment records, subscriptions, ratings, complaints and the audit log,
 * attached to the anonymous account id, because they are business and financial records and
 * other people's records point at them. Trip GPS history is removed by the 180-day retention job.
 * The exact legal retention periods are an owner/legal decision (OWNER_ACTION_REGISTER OA-07).
 */
@Controller('account')
@UseGuards(UserAuthGuard)
@Roles('passenger', 'driver')
export class AccountController {
  private readonly logger = new Logger(AccountController.name);

  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly audit: AuditService,
  ) {}

  @RateLimit({ name: 'account-delete', limit: 5, windowSeconds: 3600 })
  @Post('delete')
  @HttpCode(200)
  async deleteAccount(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Body(new ZodValidationPipe(deleteSchema)) _body: z.infer<typeof deleteSchema>,
  ) {
    const documentKeys = await this.db.transaction().execute(async (trx) => {
      const before = await trx
        .selectFrom('users')
        .select(['status'])
        .where('id', '=', user.id)
        .forUpdate()
        .executeTakeFirst();
      if (!before || before.status === 'deleted') {
        throw new AppError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Please log in.');
      }
      const open = await trx
        .selectFrom('trips')
        .select('id')
        .where(user.role === 'passenger' ? 'passenger_id' : 'driver_id', '=', user.id)
        .where('status', 'in', OPEN_STATUSES)
        .executeTakeFirst();
      if (open) {
        throw new AppError(
          HttpStatus.CONFLICT,
          'TRIP_OPEN',
          'Finish or cancel your current trip before deleting your account.',
        );
      }

      await trx
        .updateTable('users')
        .set({ status: 'deleted', phone: null, suspended_reason: null, deleted_at: sql`now()` })
        .where('id', '=', user.id)
        .execute();
      await trx
        .updateTable('auth_sessions')
        .set({ revoked_at: sql`now()` })
        .where('user_id', '=', user.id)
        .where('revoked_at', 'is', null)
        .execute();
      await trx.deleteFrom('device_tokens').where('user_id', '=', user.id).execute();
      await trx.deleteFrom('notifications').where('user_id', '=', user.id).execute();

      let keys: string[] = [];
      if (user.role === 'passenger') {
        await trx
          .updateTable('passenger_profiles')
          .set({ full_name: null, emergency_contact_phone: null })
          .where('user_id', '=', user.id)
          .execute();
        await trx.deleteFrom('saved_locations').where('passenger_id', '=', user.id).execute();
      } else {
        await trx
          .updateTable('driver_profiles')
          .set({ full_name: null })
          .where('user_id', '=', user.id)
          .execute();
        await trx.deleteFrom('driver_locations').where('driver_id', '=', user.id).execute();
        // Vehicles stay (trips point at them) but can no longer be used.
        await trx
          .updateTable('vehicles')
          .set({ is_active: false })
          .where('driver_id', '=', user.id)
          .execute();
        const docs = await trx
          .deleteFrom('driver_documents')
          .where('driver_id', '=', user.id)
          .returning('storage_key')
          .execute();
        keys = docs.map((d) => d.storage_key);
      }

      await this.audit.record(trx, {
        actorType: 'user',
        actorId: user.id,
        action: `${user.role}.account_deleted`,
        entityType: user.role,
        entityId: user.id,
        before: null,
        after: { documentsRemoved: keys.length },
        ip: req.ip ?? null,
      });
      return keys;
    });

    // Files are removed after the database commit; a failure is logged for staff to clean up
    // (the records pointing at them are already gone, so nobody can download them).
    for (const key of documentKeys) {
      try {
        await this.storage.remove(key);
      } catch (err) {
        this.logger.error({ err, key }, 'Could not remove a deleted driver document file');
      }
    }
    return { deleted: true };
  }
}
