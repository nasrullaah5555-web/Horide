import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Kysely, sql } from 'kysely';
import { z } from 'zod';
import { AppError } from '../../common/errors';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { DATABASE } from '../../database/database.module';
import type { DB } from '../../database/types';
import type { AdminPrincipal } from '../admin-auth/admin-auth.service';
import { AdminGuard, CurrentAdmin, RequirePermission } from '../admin-auth/admin.guard';
import { AuditService } from '../audit/audit.service';
import { STORAGE_PROVIDER, type StorageProvider } from '../storage/storage.provider';
import { AccountService } from '../users/account.service';
import { DriverEligibilityService } from './driver-eligibility.service';
import { REQUIRED_DRIVER_DOCUMENTS } from './driver-requirements';

const listSchema = z.strictObject({
  approval: z.enum(['pending', 'approved', 'rejected']).optional(),
  search: z.string().trim().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
const reasonSchema = z.strictObject({ reason: z.string().trim().min(3).max(300) });
const optionalNoteSchema = z.strictObject({ note: z.string().trim().max(300).optional() });

/** Driver verification and management for admins. Every decision is audited. */
@Controller('admin')
@UseGuards(AdminGuard)
export class AdminDriversController {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly audit: AuditService,
    private readonly eligibility: DriverEligibilityService,
    private readonly accounts: AccountService,
  ) {}

  @Get('drivers')
  @RequirePermission('drivers.read')
  async list(@Query(new ZodValidationPipe(listSchema)) q: z.infer<typeof listSchema>) {
    let query = this.db
      .selectFrom('users as u')
      .innerJoin('driver_profiles as d', 'd.user_id', 'u.id')
      .select([
        'u.id',
        'u.phone',
        'u.status',
        'd.full_name',
        'd.approval_status',
        'd.rating_avg',
        'u.created_at',
        sql<number>`(SELECT count(*) FROM driver_documents x WHERE x.driver_id = u.id AND x.status = 'pending')::int`.as(
          'pending_documents',
        ),
      ])
      .orderBy('u.created_at', 'desc')
      .limit(q.limit)
      .offset(q.offset);
    if (q.approval) query = query.where('d.approval_status', '=', q.approval);
    if (q.search) {
      const term = `%${q.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      query = query.where((eb) =>
        eb.or([eb('d.full_name', 'ilike', term), eb('u.phone', 'like', term)]),
      );
    }
    return { drivers: await query.execute() };
  }

  @Get('drivers/:id')
  @RequirePermission('drivers.read')
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    const driver = await this.db
      .selectFrom('users as u')
      .innerJoin('driver_profiles as d', 'd.user_id', 'u.id')
      .select([
        'u.id',
        'u.phone',
        'u.status',
        'u.suspended_reason',
        'd.full_name',
        'd.approval_status',
        'd.approved_at',
        'd.rating_avg',
        'd.rating_count',
        'u.created_at',
      ])
      .where('u.id', '=', id)
      .executeTakeFirst();
    if (!driver) throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Driver not found.');
    const [vehicles, documents, eligibility] = await Promise.all([
      this.db
        .selectFrom('vehicles')
        .selectAll()
        .where('driver_id', '=', id)
        .orderBy('created_at', 'desc')
        .execute(),
      this.db
        .selectFrom('driver_documents')
        .select([
          'id',
          'type',
          'vehicle_id',
          'mime_type',
          'size_bytes',
          'status',
          'rejection_reason',
          'reviewed_at',
          'expires_on',
          'created_at',
        ])
        .where('driver_id', '=', id)
        .orderBy('created_at', 'desc')
        .execute(),
      this.eligibility.evaluate(id),
    ]);
    return {
      driver,
      vehicles,
      documents,
      eligibility,
      requiredDocuments: REQUIRED_DRIVER_DOCUMENTS,
    };
  }

  /** Streams a document to a verification admin. Served as an attachment and audited. */
  @Get('documents/:id/file')
  @RequirePermission('documents.read')
  async downloadDocument(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const doc = await this.db
      .selectFrom('driver_documents')
      .select(['id', 'driver_id', 'storage_key', 'mime_type', 'type'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!doc) throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Document not found.');
    const data = await this.storage.get(doc.storage_key);
    await this.audit.record(this.db, {
      actorType: 'admin',
      actorId: admin.id,
      action: 'document.viewed',
      entityType: 'driver_document',
      entityId: doc.id,
      after: { driverId: doc.driver_id, type: doc.type },
      ip: req.ip ?? null,
    });
    res.setHeader('Content-Type', doc.mime_type);
    res.setHeader('Content-Disposition', `attachment; filename="${doc.type}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(data);
  }

  @Post('documents/:id/approve')
  @HttpCode(204)
  @RequirePermission('drivers.verify')
  async approveDocument(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    await this.reviewDocument(admin, id, 'approved', null, req.ip ?? null);
  }

  @Post('documents/:id/reject')
  @HttpCode(204)
  @RequirePermission('drivers.verify')
  async rejectDocument(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(reasonSchema)) body: z.infer<typeof reasonSchema>,
    @Req() req: Request,
  ) {
    await this.reviewDocument(admin, id, 'rejected', body.reason, req.ip ?? null);
  }

  @Post('vehicles/:id/approve')
  @HttpCode(204)
  @RequirePermission('drivers.verify')
  async approveVehicle(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    await this.reviewVehicle(admin, id, 'approved', null, req.ip ?? null);
  }

  @Post('vehicles/:id/reject')
  @HttpCode(204)
  @RequirePermission('drivers.verify')
  async rejectVehicle(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(reasonSchema)) body: z.infer<typeof reasonSchema>,
    @Req() req: Request,
  ) {
    await this.reviewVehicle(admin, id, 'rejected', body.reason, req.ip ?? null);
  }

  /** Approves a driver only when every required document and the vehicle are approved. */
  @Post('drivers/:id/approve')
  @HttpCode(204)
  @RequirePermission('drivers.verify')
  async approveDriver(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(optionalNoteSchema)) body: z.infer<typeof optionalNoteSchema>,
    @Req() req: Request,
  ) {
    const check = await this.eligibility.evaluate(id);
    if (check.missingDocuments.length > 0 || !check.vehicle) {
      throw new AppError(
        HttpStatus.CONFLICT,
        'DRIVER_INCOMPLETE',
        'Approve all required documents and the vehicle first.',
        {
          missingDocuments: check.missingDocuments,
          vehicleApproved: check.vehicle !== null,
        },
      );
    }
    await this.db.transaction().execute(async (trx) => {
      const updated = await trx
        .updateTable('driver_profiles')
        .set({ approval_status: 'approved', approved_by: admin.id, approved_at: sql`now()` })
        .where('user_id', '=', id)
        .where('approval_status', '<>', 'approved')
        .returning('user_id')
        .executeTakeFirst();
      if (!updated)
        throw new AppError(HttpStatus.CONFLICT, 'ALREADY_APPROVED', 'Driver is already approved.');
      await this.audit.record(trx, {
        actorType: 'admin',
        actorId: admin.id,
        action: 'driver.approved',
        entityType: 'driver',
        entityId: id,
        after: { note: body.note ?? null },
        ip: req.ip ?? null,
      });
    });
  }

  @Post('drivers/:id/reject')
  @HttpCode(204)
  @RequirePermission('drivers.verify')
  async rejectDriver(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(reasonSchema)) body: z.infer<typeof reasonSchema>,
    @Req() req: Request,
  ) {
    await this.db.transaction().execute(async (trx) => {
      const updated = await trx
        .updateTable('driver_profiles')
        .set({ approval_status: 'rejected', approved_by: null, approved_at: null })
        .where('user_id', '=', id)
        .returning('user_id')
        .executeTakeFirst();
      if (!updated) throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Driver not found.');
      await this.audit.record(trx, {
        actorType: 'admin',
        actorId: admin.id,
        action: 'driver.rejected',
        entityType: 'driver',
        entityId: id,
        after: { reason: body.reason },
        ip: req.ip ?? null,
      });
    });
  }

  /** Suspension stops NEW offers immediately. A trip already in progress is not interrupted (BR-05). */
  @Post('drivers/:id/suspend')
  @HttpCode(204)
  @RequirePermission('drivers.suspend')
  async suspend(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(reasonSchema)) body: z.infer<typeof reasonSchema>,
    @Req() req: Request,
  ) {
    await this.accounts.setStatus(
      { id: admin.id, ip: req.ip ?? null },
      id,
      'driver',
      'suspended',
      body.reason,
    );
  }

  @Post('drivers/:id/reinstate')
  @HttpCode(204)
  @RequirePermission('drivers.suspend')
  async reinstate(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(optionalNoteSchema)) body: z.infer<typeof optionalNoteSchema>,
    @Req() req: Request,
  ) {
    await this.accounts.setStatus(
      { id: admin.id, ip: req.ip ?? null },
      id,
      'driver',
      'active',
      body.note ?? null,
    );
  }

  private async reviewDocument(
    admin: AdminPrincipal,
    id: string,
    status: 'approved' | 'rejected',
    reason: string | null,
    ip: string | null,
  ) {
    await this.db.transaction().execute(async (trx) => {
      const doc = await trx
        .updateTable('driver_documents')
        .set({ status, reviewed_by: admin.id, reviewed_at: sql`now()`, rejection_reason: reason })
        .where('id', '=', id)
        .returning(['id', 'driver_id', 'type'])
        .executeTakeFirst();
      if (!doc) throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Document not found.');
      await this.audit.record(trx, {
        actorType: 'admin',
        actorId: admin.id,
        action: `document.${status}`,
        entityType: 'driver_document',
        entityId: id,
        after: { driverId: doc.driver_id, type: doc.type, reason },
        ip,
      });
    });
  }

  private async reviewVehicle(
    admin: AdminPrincipal,
    id: string,
    status: 'approved' | 'rejected',
    reason: string | null,
    ip: string | null,
  ) {
    await this.db.transaction().execute(async (trx) => {
      const vehicle = await trx
        .updateTable('vehicles')
        .set({
          approval_status: status,
          approved_by: status === 'approved' ? admin.id : null,
          approved_at: status === 'approved' ? sql`now()` : null,
          rejection_reason: reason,
        })
        .where('id', '=', id)
        .returning(['id', 'driver_id', 'plate_number'])
        .executeTakeFirst();
      if (!vehicle) throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Vehicle not found.');
      await this.audit.record(trx, {
        actorType: 'admin',
        actorId: admin.id,
        action: `vehicle.${status}`,
        entityType: 'vehicle',
        entityId: id,
        after: { driverId: vehicle.driver_id, plate: vehicle.plate_number, reason },
        ip,
      });
    });
  }
}
