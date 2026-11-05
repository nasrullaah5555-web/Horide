import { RateLimit } from '../../common/rate-limit';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { Kysely, sql } from 'kysely';
import { z } from 'zod';
import { AppError } from '../../common/errors';
import { geoPoint, latLngSchema, latOf, lngOf } from '../../common/geo';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { DATABASE } from '../../database/database.module';
import type { DB } from '../../database/types';
import type { AdminPrincipal } from '../admin-auth/admin-auth.service';
import { AdminGuard, CurrentAdmin, RequirePermission } from '../admin-auth/admin.guard';
import { AuditService } from '../audit/audit.service';
import { type AuthUser, CurrentUser, Roles, UserAuthGuard } from '../auth/auth.guard';

/**
 * Ethiopian public emergency numbers, shown with every emergency alert.
 * Source: Wikipedia "List of emergency telephone numbers" (checked 2026-11-05). Confirm locally
 * in Jijiga before launch (OWNER_ACTION_REGISTER OA-19).
 */
export const EMERGENCY_NUMBERS = [
  { service: 'Police', number: '991' },
  { service: 'Ambulance', number: '907' },
  { service: 'Fire', number: '939' },
  { service: 'Traffic police', number: '945' },
] as const;

const ratingSchema = z.strictObject({
  stars: z.number().int().min(1).max(5),
  comment: z.string().trim().max(500).optional(),
});
const complaintSchema = z.strictObject({
  tripId: z.string().uuid().optional(),
  category: z.enum(['safety', 'payment', 'behaviour', 'vehicle', 'app', 'other']),
  description: z.string().trim().min(5).max(2000),
});
const emergencySchema = z.strictObject({
  tripId: z.string().uuid().optional(),
  position: latLngSchema.optional(),
});
const complaintUpdateSchema = z
  .strictObject({
    status: z.enum(['in_review', 'resolved', 'closed']),
    resolution: z.string().trim().min(3).max(2000).optional(),
  })
  .refine((v) => v.status === 'in_review' || v.resolution, {
    message: 'A resolution is required',
    path: ['resolution'],
  });
const handleEmergencySchema = z.strictObject({ notes: z.string().trim().min(3).max(2000) });
const adminListSchema = z.strictObject({
  open: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

@Controller()
export class FeedbackController {
  private readonly logger = new Logger(FeedbackController.name);

  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    private readonly audit: AuditService,
  ) {}

  /** Passenger rates the driver, or driver rates the passenger, once per completed trip. */
  @Post('trips/:id/rating')
  @HttpCode(201)
  @UseGuards(UserAuthGuard)
  @Roles('passenger', 'driver')
  async rate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) tripId: string,
    @Body(new ZodValidationPipe(ratingSchema)) body: z.infer<typeof ratingSchema>,
  ) {
    return this.db.transaction().execute(async (trx) => {
      const trip = await trx
        .selectFrom('trips')
        .select(['passenger_id', 'driver_id', 'status'])
        .where('id', '=', tripId)
        .where(user.role === 'passenger' ? 'passenger_id' : 'driver_id', '=', user.id)
        .executeTakeFirst();
      if (!trip) throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Trip not found.');
      if (trip.status !== 'completed' || !trip.driver_id) {
        throw new AppError(
          HttpStatus.CONFLICT,
          'TRIP_NOT_COMPLETED',
          'You can rate a trip once it is completed.',
        );
      }
      const rateeId = user.role === 'passenger' ? trip.driver_id : trip.passenger_id;
      const inserted = await trx
        .insertInto('ratings')
        .values({
          trip_id: tripId,
          rater_id: user.id,
          ratee_id: rateeId,
          stars: body.stars,
          comment: body.comment ?? null,
        })
        .onConflict((oc) => oc.columns(['trip_id', 'rater_id']).doNothing())
        .returning('id')
        .executeTakeFirst();
      if (!inserted)
        throw new AppError(
          HttpStatus.CONFLICT,
          'ALREADY_RATED',
          'You have already rated this trip.',
        );

      if (user.role === 'passenger') {
        // Recomputed from the ratings table so the average can never drift from the real data.
        await sql`
          UPDATE driver_profiles d SET
            rating_avg = s.avg, rating_count = s.n
          FROM (SELECT round(avg(stars)::numeric, 2) AS avg, count(*)::int AS n FROM ratings WHERE ratee_id = ${rateeId}) s
          WHERE d.user_id = ${rateeId}`.execute(trx);
      }
      return { id: inserted.id, stars: body.stars };
    });
  }

  @RateLimit({ name: 'complaints', limit: 5, windowSeconds: 60 })
  @Post('complaints')
  @HttpCode(201)
  @UseGuards(UserAuthGuard)
  @Roles('passenger', 'driver')
  async complain(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(complaintSchema)) body: z.infer<typeof complaintSchema>,
  ) {
    let againstUserId: string | null = null;
    if (body.tripId) {
      const trip = await this.db
        .selectFrom('trips')
        .select(['passenger_id', 'driver_id'])
        .where('id', '=', body.tripId)
        .where(user.role === 'passenger' ? 'passenger_id' : 'driver_id', '=', user.id)
        .executeTakeFirst();
      if (!trip) throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Trip not found.');
      againstUserId = user.role === 'passenger' ? trip.driver_id : trip.passenger_id;
    }
    const recent = await this.db
      .selectFrom('complaints')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('reporter_id', '=', user.id)
      .where('created_at', '>', sql<Date>`now() - interval '1 day'`)
      .executeTakeFirstOrThrow();
    if (Number(recent.n) >= 10) {
      throw new AppError(
        HttpStatus.TOO_MANY_REQUESTS,
        'COMPLAINT_LIMIT',
        'Too many reports today. Contact support directly.',
      );
    }
    return this.db
      .insertInto('complaints')
      .values({
        trip_id: body.tripId ?? null,
        reporter_id: user.id,
        against_user_id: againstUserId,
        category: body.category,
        description: body.description,
        assigned_to: null,
        resolution: null,
        resolved_at: null,
      })
      .returning(['id', 'status', 'created_at'])
      .executeTakeFirstOrThrow();
  }

  @Get('complaints')
  @UseGuards(UserAuthGuard)
  @Roles('passenger', 'driver')
  async myComplaints(@CurrentUser() user: AuthUser) {
    const complaints = await this.db
      .selectFrom('complaints')
      .select([
        'id',
        'trip_id',
        'category',
        'description',
        'status',
        'resolution',
        'created_at',
        'resolved_at',
      ])
      .where('reporter_id', '=', user.id)
      .orderBy('created_at', 'desc')
      .limit(50)
      .execute();
    return { complaints };
  }

  /**
   * Emergency button. Records the alert with the trip and position, logs it at error level so
   * monitoring raises an alarm, and returns the public emergency numbers to call immediately.
   * Musride staff are NOT an emergency service; the app always shows the numbers first.
   */
  @Post('emergency')
  @HttpCode(201)
  @UseGuards(UserAuthGuard)
  @Roles('passenger', 'driver')
  async emergency(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(emergencySchema)) body: z.infer<typeof emergencySchema>,
  ) {
    let tripId: string | null = null;
    if (body.tripId) {
      const trip = await this.db
        .selectFrom('trips')
        .select('id')
        .where('id', '=', body.tripId)
        .where(user.role === 'passenger' ? 'passenger_id' : 'driver_id', '=', user.id)
        .executeTakeFirst();
      tripId = trip?.id ?? null; // never refuse an emergency because of a wrong trip id
    }
    const event = await this.db
      .insertInto('emergency_events')
      .values({
        trip_id: tripId,
        user_id: user.id,
        position: body.position ? geoPoint(body.position) : null,
        handled_by: null,
        handled_at: null,
        notes: null,
      })
      .returning(['id', 'created_at'])
      .executeTakeFirstOrThrow();
    this.logger.error({ emergencyId: event.id, tripId, role: user.role }, 'EMERGENCY ALERT raised');
    return { id: event.id, createdAt: event.created_at, emergencyNumbers: EMERGENCY_NUMBERS };
  }

  @Get('admin/complaints')
  @UseGuards(AdminGuard)
  @RequirePermission('complaints.read')
  async adminComplaints(
    @Query(new ZodValidationPipe(adminListSchema)) q: z.infer<typeof adminListSchema>,
  ) {
    let query = this.db
      .selectFrom('complaints')
      .selectAll()
      .orderBy('created_at', 'desc')
      .limit(q.limit);
    if (q.open === 'true') query = query.where('status', 'in', ['open', 'in_review']);
    return { complaints: await query.execute() };
  }

  @Post('admin/complaints/:id')
  @HttpCode(204)
  @UseGuards(AdminGuard)
  @RequirePermission('complaints.write')
  async updateComplaint(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(complaintUpdateSchema)) body: z.infer<typeof complaintUpdateSchema>,
    @Req() req: Request,
  ) {
    await this.db.transaction().execute(async (trx) => {
      const before = await trx
        .selectFrom('complaints')
        .select(['status'])
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (!before) throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Complaint not found.');
      if (before.status === 'closed')
        throw new AppError(HttpStatus.CONFLICT, 'COMPLAINT_CLOSED', 'This complaint is closed.');
      const finishing = body.status !== 'in_review';
      await trx
        .updateTable('complaints')
        .set({
          status: body.status,
          assigned_to: admin.id,
          ...(finishing ? { resolution: body.resolution ?? null, resolved_at: sql`now()` } : {}),
        })
        .where('id', '=', id)
        .execute();
      await this.audit.record(trx, {
        actorType: 'admin',
        actorId: admin.id,
        action: `complaint.${body.status}`,
        entityType: 'complaint',
        entityId: id,
        before,
        after: { status: body.status, resolution: body.resolution ?? null },
        ip: req.ip ?? null,
      });
    });
  }

  @Get('admin/emergencies')
  @UseGuards(AdminGuard)
  @RequirePermission('emergencies.read')
  async adminEmergencies(
    @Query(new ZodValidationPipe(adminListSchema)) q: z.infer<typeof adminListSchema>,
  ) {
    let query = this.db
      .selectFrom('emergency_events as e')
      .innerJoin('users as u', 'u.id', 'e.user_id')
      .select([
        'e.id',
        'e.trip_id',
        'e.user_id',
        'u.phone',
        'u.role',
        'e.created_at',
        'e.handled_by',
        'e.handled_at',
        'e.notes',
        latOf('e.position').as('lat'),
        lngOf('e.position').as('lng'),
      ])
      .orderBy('e.created_at', 'desc')
      .limit(q.limit);
    if (q.open === 'true') query = query.where('e.handled_at', 'is', null);
    return { emergencies: await query.execute() };
  }

  @Post('admin/emergencies/:id/handle')
  @HttpCode(204)
  @UseGuards(AdminGuard)
  @RequirePermission('emergencies.write')
  async handleEmergency(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(handleEmergencySchema)) body: z.infer<typeof handleEmergencySchema>,
    @Req() req: Request,
  ) {
    await this.db.transaction().execute(async (trx) => {
      const updated = await trx
        .updateTable('emergency_events')
        .set({ handled_by: admin.id, handled_at: sql`now()`, notes: body.notes })
        .where('id', '=', id)
        .where('handled_at', 'is', null)
        .returning('id')
        .executeTakeFirst();
      if (!updated)
        throw new AppError(
          HttpStatus.CONFLICT,
          'ALREADY_HANDLED',
          'This alert was already handled or does not exist.',
        );
      await this.audit.record(trx, {
        actorType: 'admin',
        actorId: admin.id,
        action: 'emergency.handled',
        entityType: 'emergency_event',
        entityId: id,
        after: { notes: body.notes },
        ip: req.ip ?? null,
      });
    });
  }
}
