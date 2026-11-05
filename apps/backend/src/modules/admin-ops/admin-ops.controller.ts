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
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { Kysely, sql } from 'kysely';
import { z } from 'zod';
import { AppError } from '../../common/errors';
import { latOf, lngOf } from '../../common/geo';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { DATABASE } from '../../database/database.module';
import type { DB } from '../../database/types';
import type { AdminPrincipal } from '../admin-auth/admin-auth.service';
import { AdminGuard, CurrentAdmin, RequirePermission } from '../admin-auth/admin.guard';
import { AuditService } from '../audit/audit.service';
import { LIVE_LOCATION_MAX_AGE_SECONDS } from '../locations/location-rules';
import { TripsService } from '../trips/trips.service';
import { AccountService } from '../users/account.service';

const TRIP_STATUSES = [
  'requested',
  'searching',
  'accepted',
  'driver_arriving',
  'arrived',
  'in_progress',
  'completed',
  'cancelled',
  'expired',
] as const;

const passengersSchema = z.strictObject({
  search: z.string().trim().max(60).optional(),
  status: z.enum(['active', 'suspended']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
const tripsSchema = z.strictObject({
  status: z.enum(TRIP_STATUSES).optional(),
  passengerId: z.string().uuid().optional(),
  driverId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
const reportSchema = z.strictObject({ days: z.coerce.number().int().min(1).max(90).default(30) });
const reasonSchema = z.strictObject({ reason: z.string().trim().min(3).max(300) });
const noteSchema = z.strictObject({ note: z.string().trim().max(300).optional() });

/** Escapes LIKE wildcards so search text is matched literally. */
function likeTerm(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * Operational views for staff. Every number comes from a live database query;
 * nothing is estimated, sampled or made up (master prompt §6, directive Phase 8).
 */
@Controller('admin')
@UseGuards(AdminGuard)
export class AdminOpsController {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    private readonly accounts: AccountService,
    private readonly trips: TripsService,
    private readonly audit: AuditService,
  ) {}

  @Get('dashboard')
  @RequirePermission('reports.read')
  async dashboard() {
    const { rows } = await sql<Record<string, string>>`
      SELECT
        (SELECT count(*) FROM trips WHERE requested_at >= date_trunc('day', now() AT TIME ZONE 'Africa/Addis_Ababa') AT TIME ZONE 'Africa/Addis_Ababa') AS trips_today,
        (SELECT count(*) FROM trips WHERE status = 'completed' AND completed_at >= date_trunc('day', now() AT TIME ZONE 'Africa/Addis_Ababa') AT TIME ZONE 'Africa/Addis_Ababa') AS completed_today,
        (SELECT count(*) FROM trips WHERE status IN ('accepted','driver_arriving','arrived','in_progress')) AS active_trips,
        (SELECT count(*) FROM trips WHERE status = 'searching') AS searching_trips,
        (SELECT count(*) FROM trips WHERE requested_at >= now() - interval '7 days') AS trips_7d,
        (SELECT count(*) FROM trips WHERE status = 'completed' AND completed_at >= now() - interval '7 days') AS completed_7d,
        (SELECT count(*) FROM trips WHERE status = 'expired' AND requested_at >= now() - interval '7 days') AS unfulfilled_7d,
        (SELECT count(*) FROM driver_locations WHERE is_online AND recorded_at > now() - make_interval(secs => ${LIVE_LOCATION_MAX_AGE_SECONDS})) AS drivers_online,
        (SELECT count(*) FROM driver_profiles WHERE approval_status = 'approved') AS drivers_approved,
        (SELECT count(*) FROM driver_profiles WHERE approval_status = 'pending') AS drivers_pending,
        (SELECT count(DISTINCT driver_id) FROM subscriptions WHERE status = 'active' AND starts_at <= now() AND ends_at > now()) AS active_subscriptions,
        (SELECT count(DISTINCT driver_id) FROM subscriptions WHERE status = 'active' AND ends_at > now() AND ends_at <= now() + interval '7 days') AS subscriptions_expiring_7d,
        (SELECT count(*) FROM users WHERE role = 'passenger' AND status <> 'deleted') AS passengers,
        (SELECT count(*) FROM complaints WHERE status IN ('open','in_review')) AS open_complaints,
        (SELECT count(*) FROM emergency_events WHERE handled_at IS NULL) AS open_emergencies,
        (SELECT count(*) FROM payments WHERE status = 'disputed') AS open_payment_disputes,
        (SELECT count(*) FROM driver_documents WHERE status = 'pending') AS documents_to_review
    `.execute(this.db);
    const counts = Object.fromEntries(
      Object.entries(rows[0] ?? {}).map(([k, v]) => [k, Number(v)]),
    );
    return { generatedAt: new Date(), counts };
  }

  /** Daily trip outcomes for charts. Fares are the amounts recorded on trips, not money Musride holds. */
  @Get('reports/trips')
  @RequirePermission('reports.read')
  async tripReport(@Query(new ZodValidationPipe(reportSchema)) q: z.infer<typeof reportSchema>) {
    const { rows } = await sql<{
      day: string;
      requested: number;
      completed: number;
      cancelled: number;
      expired: number;
      completed_fares: string;
    }>`
      SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
             count(t.id)::int AS requested,
             count(t.id) FILTER (WHERE t.status = 'completed')::int AS completed,
             count(t.id) FILTER (WHERE t.status = 'cancelled')::int AS cancelled,
             count(t.id) FILTER (WHERE t.status = 'expired')::int AS expired,
             coalesce(sum(t.final_fare) FILTER (WHERE t.status = 'completed'), 0)::text AS completed_fares
      FROM generate_series(
             (date_trunc('day', now() AT TIME ZONE 'Africa/Addis_Ababa') - make_interval(days => ${q.days - 1}))::date,
             (now() AT TIME ZONE 'Africa/Addis_Ababa')::date,
             interval '1 day') AS d(day)
      LEFT JOIN trips t ON (t.requested_at AT TIME ZONE 'Africa/Addis_Ababa')::date = d.day::date
      GROUP BY d.day ORDER BY d.day
    `.execute(this.db);
    return { timezone: 'Africa/Addis_Ababa', days: rows };
  }

  @Get('live-drivers')
  @RequirePermission('drivers.read')
  async liveDrivers() {
    const drivers = await this.db
      .selectFrom('driver_locations as l')
      .innerJoin('driver_profiles as d', 'd.user_id', 'l.driver_id')
      .leftJoin('vehicles as v', (j) =>
        j
          .onRef('v.driver_id', '=', 'l.driver_id')
          .on('v.approval_status', '=', 'approved')
          .on('v.is_active', '=', true),
      )
      .select([
        'l.driver_id',
        'd.full_name',
        'v.category',
        'v.plate_number',
        latOf('l.position').as('lat'),
        lngOf('l.position').as('lng'),
        'l.recorded_at',
        sql<number>`extract(epoch from (now() - l.recorded_at))::int`.as('age_seconds'),
        sql<boolean>`EXISTS (SELECT 1 FROM trips t WHERE t.driver_id = l.driver_id AND t.status IN ('accepted','driver_arriving','arrived','in_progress'))`.as(
          'on_trip',
        ),
      ])
      .where('l.is_online', '=', true)
      .where('l.recorded_at', '>', sql<Date>`now() - interval '10 minutes'`)
      .execute();
    return {
      liveThresholdSeconds: LIVE_LOCATION_MAX_AGE_SECONDS,
      drivers: drivers.map((d) => ({
        ...d,
        isLive: d.age_seconds <= LIVE_LOCATION_MAX_AGE_SECONDS,
      })),
    };
  }

  @Get('passengers')
  @RequirePermission('users.read')
  async passengers(
    @Query(new ZodValidationPipe(passengersSchema)) q: z.infer<typeof passengersSchema>,
  ) {
    let query = this.db
      .selectFrom('users as u')
      .innerJoin('passenger_profiles as p', 'p.user_id', 'u.id')
      .select([
        'u.id',
        'u.phone',
        'u.status',
        'u.suspended_reason',
        'p.full_name',
        'u.created_at',
        sql<number>`(SELECT count(*) FROM trips t WHERE t.passenger_id = u.id AND t.status = 'completed')::int`.as(
          'completed_trips',
        ),
      ])
      .where('u.role', '=', 'passenger')
      .where('u.status', '<>', 'deleted')
      .orderBy('u.created_at', 'desc')
      .limit(q.limit)
      .offset(q.offset);
    if (q.status) query = query.where('u.status', '=', q.status);
    if (q.search) {
      const term = likeTerm(q.search);
      query = query.where((eb) =>
        eb.or([eb('p.full_name', 'ilike', term), eb('u.phone', 'like', term)]),
      );
    }
    return { passengers: await query.execute() };
  }

  @Post('passengers/:id/suspend')
  @HttpCode(204)
  @RequirePermission('users.suspend')
  async suspendPassenger(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(reasonSchema)) body: z.infer<typeof reasonSchema>,
    @Req() req: Request,
  ) {
    await this.accounts.setStatus(
      { id: admin.id, ip: req.ip ?? null },
      id,
      'passenger',
      'suspended',
      body.reason,
    );
  }

  @Post('passengers/:id/reinstate')
  @HttpCode(204)
  @RequirePermission('users.suspend')
  async reinstatePassenger(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(noteSchema)) body: z.infer<typeof noteSchema>,
    @Req() req: Request,
  ) {
    await this.accounts.setStatus(
      { id: admin.id, ip: req.ip ?? null },
      id,
      'passenger',
      'active',
      body.note ?? null,
    );
  }

  @Get('trips')
  @RequirePermission('trips.read')
  async listTrips(@Query(new ZodValidationPipe(tripsSchema)) q: z.infer<typeof tripsSchema>) {
    let query = this.db
      .selectFrom('trips as t')
      .leftJoin('passenger_profiles as p', 'p.user_id', 't.passenger_id')
      .leftJoin('driver_profiles as d', 'd.user_id', 't.driver_id')
      .select([
        't.id',
        't.status',
        't.category',
        't.pickup_text',
        't.destination_text',
        't.quoted_fare',
        't.final_fare',
        't.payment_method',
        't.requested_at',
        't.completed_at',
        't.cancelled_by',
        't.passenger_id',
        'p.full_name as passenger_name',
        't.driver_id',
        'd.full_name as driver_name',
      ])
      .orderBy('t.requested_at', 'desc')
      .limit(q.limit)
      .offset(q.offset);
    if (q.status) query = query.where('t.status', '=', q.status);
    if (q.passengerId) query = query.where('t.passenger_id', '=', q.passengerId);
    if (q.driverId) query = query.where('t.driver_id', '=', q.driverId);
    if (q.from) query = query.where('t.requested_at', '>=', q.from);
    if (q.to) query = query.where('t.requested_at', '<', q.to);
    return { trips: await query.execute() };
  }

  @Get('trips/:id')
  @RequirePermission('trips.read')
  async tripDetail(@Param('id', ParseUUIDPipe) id: string) {
    const trip = await this.db
      .selectFrom('trips')
      .selectAll()
      .select([
        latOf('pickup').as('pickup_lat'),
        lngOf('pickup').as('pickup_lng'),
        latOf('destination').as('destination_lat'),
        lngOf('destination').as('destination_lng'),
      ])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!trip) throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Trip not found.');
    const { pickup: _p, destination: _d, quote_hash: _q, ...rest } = trip;
    const [events, payment, offers, route] = await Promise.all([
      this.db
        .selectFrom('trip_events')
        .selectAll()
        .where('trip_id', '=', id)
        .orderBy('id')
        .execute(),
      this.db.selectFrom('payments').selectAll().where('trip_id', '=', id).executeTakeFirst(),
      this.db
        .selectFrom('trip_offers')
        .select(['driver_id', 'wave', 'distance_m', 'status', 'created_at', 'responded_at'])
        .where('trip_id', '=', id)
        .orderBy('created_at')
        .execute(),
      this.db
        .selectFrom('trip_locations')
        .select([latOf('position').as('lat'), lngOf('position').as('lng'), 'recorded_at'])
        .where('trip_id', '=', id)
        .orderBy('recorded_at')
        .limit(2000)
        .execute(),
    ]);
    return { trip: rest, events, payment: payment ?? null, offers, route };
  }

  /** Staff can cancel any unfinished trip, including one in progress (e.g. after an emergency). */
  @Post('trips/:id/cancel')
  @HttpCode(204)
  @RequirePermission('trips.cancel')
  async cancelTrip(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(reasonSchema)) body: z.infer<typeof reasonSchema>,
    @Req() req: Request,
  ) {
    await this.trips.transition('cancel', { party: 'admin', id: admin.id }, id, {
      reason: body.reason,
    });
    await this.audit.record(this.db, {
      actorType: 'admin',
      actorId: admin.id,
      action: 'trip.cancelled_by_admin',
      entityType: 'trip',
      entityId: id,
      after: { reason: body.reason },
      ip: req.ip ?? null,
    });
  }
}
