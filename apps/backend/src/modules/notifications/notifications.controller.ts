import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { Kysely, sql } from 'kysely';
import { z } from 'zod';
import { AppError } from '../../common/errors';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { DATABASE } from '../../database/database.module';
import type { DB } from '../../database/types';
import type { AdminPrincipal } from '../admin-auth/admin-auth.service';
import { AdminGuard, CurrentAdmin, RequirePermission } from '../admin-auth/admin.guard';
import { AuditService } from '../audit/audit.service';
import { type AuthUser, CurrentUser, Roles, UserAuthGuard } from '../auth/auth.guard';
import { NotificationsService } from './notifications.service';

const deviceSchema = z.strictObject({
  token: z.string().min(10).max(4096),
  platform: z.enum(['android', 'ios']),
});
const removeDeviceSchema = z.strictObject({ token: z.string().min(10).max(4096) });
const broadcastSchema = z.strictObject({
  audience: z.enum(['all_passengers', 'all_drivers', 'approved_drivers']),
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(500),
});

@Controller()
export class NotificationsController {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  @Get('notifications')
  @UseGuards(UserAuthGuard)
  @Roles('passenger', 'driver')
  async list(@CurrentUser() user: AuthUser) {
    const items = await this.db
      .selectFrom('notifications')
      .select(['id', 'type', 'title', 'body', 'data', 'read_at', 'created_at'])
      .where('user_id', '=', user.id)
      .orderBy('created_at', 'desc')
      .limit(50)
      .execute();
    const unread = await this.db
      .selectFrom('notifications')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('user_id', '=', user.id)
      .where('read_at', 'is', null)
      .executeTakeFirstOrThrow();
    return { notifications: items, unread: Number(unread.n) };
  }

  @Post('notifications/:id/read')
  @HttpCode(204)
  @UseGuards(UserAuthGuard)
  @Roles('passenger', 'driver')
  async read(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const res = await this.db
      .updateTable('notifications')
      .set({ read_at: sql`coalesce(read_at, now())` })
      .where('id', '=', id)
      .where('user_id', '=', user.id)
      .executeTakeFirst();
    if (Number(res.numUpdatedRows) === 0)
      throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Notification not found.');
  }

  @Post('notifications/read-all')
  @HttpCode(204)
  @UseGuards(UserAuthGuard)
  @Roles('passenger', 'driver')
  async readAll(@CurrentUser() user: AuthUser) {
    await this.db
      .updateTable('notifications')
      .set({ read_at: sql`now()` })
      .where('user_id', '=', user.id)
      .where('read_at', 'is', null)
      .execute();
  }

  /**
   * Registers this phone for push notifications. A token belongs to one phone; if another account
   * used it before (e.g. logged out and someone else logged in), it moves to the current account.
   */
  @Post('devices')
  @HttpCode(204)
  @UseGuards(UserAuthGuard)
  @Roles('passenger', 'driver')
  async registerDevice(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(deviceSchema)) body: z.infer<typeof deviceSchema>,
  ) {
    await this.db
      .insertInto('device_tokens')
      .values({ user_id: user.id, fcm_token: body.token, platform: body.platform })
      .onConflict((oc) =>
        oc
          .column('fcm_token')
          .doUpdateSet({ user_id: user.id, platform: body.platform, last_seen_at: sql`now()` }),
      )
      .execute();
    // Keep at most 5 devices per account.
    await sql`DELETE FROM device_tokens WHERE user_id = ${user.id} AND id NOT IN (
      SELECT id FROM device_tokens WHERE user_id = ${user.id} ORDER BY last_seen_at DESC LIMIT 5)`.execute(
      this.db,
    );
  }

  /** Called on logout so the phone stops receiving this account's notifications. */
  @Delete('devices')
  @HttpCode(204)
  @UseGuards(UserAuthGuard)
  @Roles('passenger', 'driver')
  async removeDevice(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(removeDeviceSchema)) body: z.infer<typeof removeDeviceSchema>,
  ) {
    await this.db
      .deleteFrom('device_tokens')
      .where('user_id', '=', user.id)
      .where('fcm_token', '=', body.token)
      .execute();
  }

  /** Operations staff send an announcement to a whole group. Audited, including the text sent. */
  @Post('admin/notifications')
  @HttpCode(201)
  @UseGuards(AdminGuard)
  @RequirePermission('notifications.send')
  async broadcast(
    @CurrentAdmin() admin: AdminPrincipal,
    @Body(new ZodValidationPipe(broadcastSchema)) body: z.infer<typeof broadcastSchema>,
    @Req() req: Request,
  ) {
    let recipients = this.db
      .selectFrom('users as u')
      .select('u.id')
      .where('u.status', '=', 'active');
    if (body.audience === 'all_passengers')
      recipients = recipients.where('u.role', '=', 'passenger');
    if (body.audience === 'all_drivers') recipients = recipients.where('u.role', '=', 'driver');
    if (body.audience === 'approved_drivers') {
      recipients = recipients
        .innerJoin('driver_profiles as d', 'd.user_id', 'u.id')
        .where('u.role', '=', 'driver')
        .where('d.approval_status', '=', 'approved');
    }
    const ids = (await recipients.execute()).map((r) => r.id);
    await this.audit.record(this.db, {
      actorType: 'admin',
      actorId: admin.id,
      action: 'notification.broadcast',
      entityType: 'notification',
      entityId: null,
      after: {
        audience: body.audience,
        title: body.title,
        body: body.body,
        recipients: ids.length,
      },
      ip: req.ip ?? null,
    });
    for (const id of ids) {
      await this.notifications.notify(id, {
        type: 'announcement',
        title: body.title,
        body: body.body,
      });
    }
    return { recipients: ids.length };
  }
}
