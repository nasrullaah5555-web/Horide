import { RateLimit } from '../../common/rate-limit';
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { z } from 'zod';
import { DomainEvents } from '../../common/domain-events';
import { AppError } from '../../common/errors';
import { geoPoint, latLngSchema, latOf, lngOf } from '../../common/geo';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { DATABASE } from '../../database/database.module';
import type { DB } from '../../database/types';
import { type AuthUser, CurrentUser, Roles, UserAuthGuard } from '../auth/auth.guard';
import { DriverEligibilityService } from '../drivers/driver-eligibility.service';
import { ACTIVE_STATUSES } from '../trips/trip-state';
import { judgePoint, type LocationPoint, type PointVerdict } from './location-rules';

const pointSchema = latLngSchema.extend({
  recordedAt: z.coerce.date(),
  accuracyM: z.number().min(0).max(10_000).optional(),
  heading: z.number().min(0).max(360).optional(),
  speedKmh: z.number().min(0).max(400).optional(),
  mocked: z.boolean().optional(),
});

const availabilitySchema = z.strictObject({
  online: z.boolean(),
  position: pointSchema.optional(),
});

/** Up to 20 points per request, so a phone that lost signal can send what it buffered. */
const locationSchema = z.strictObject({ points: z.array(pointSchema).min(1).max(20) });

type Point = z.infer<typeof pointSchema>;

@Controller('driver')
@UseGuards(UserAuthGuard)
@Roles('driver')
export class LocationsController {
  private readonly logger = new Logger(LocationsController.name);

  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    private readonly eligibility: DriverEligibilityService,
    private readonly events: DomainEvents,
  ) {}

  /** Going online requires full eligibility and a fresh, accurate position. Going offline always works. */
  @Post('availability')
  @HttpCode(200)
  async setAvailability(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(availabilitySchema)) body: z.infer<typeof availabilitySchema>,
  ) {
    if (!body.online) {
      await this.db
        .updateTable('driver_locations')
        .set({ is_online: false })
        .where('driver_id', '=', user.id)
        .execute();
      return { online: false };
    }

    const check = await this.eligibility.evaluate(user.id);
    if (!check.eligible) {
      throw new AppError(HttpStatus.FORBIDDEN, 'NOT_ELIGIBLE', 'You cannot go online yet.', {
        reasons: check.reasons,
      });
    }
    if (!body.position) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'POSITION_REQUIRED',
        'Turn on location to go online.',
      );
    }
    const verdict = judgePoint(toPoint(body.position), null, new Date());
    if (verdict !== 'ok') throw rejectPoint(verdict);

    await this.upsertCurrent(user.id, body.position, true);
    return { online: true, subscriptionEndsAt: check.subscriptionEndsAt };
  }

  /**
   * Location updates. Each point is checked; implausible points are dropped (and counted),
   * never stored as the driver's position. During a trip, accepted points are also kept as trip history.
   */
  @RateLimit({ name: 'location', limit: 30, windowSeconds: 60 })
  @Post('location')
  @HttpCode(200)
  async updateLocation(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(locationSchema)) body: z.infer<typeof locationSchema>,
  ) {
    const now = new Date();
    const points = [...body.points].sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());

    const current = await this.db
      .selectFrom('driver_locations')
      .select([
        latOf('position').as('lat'),
        lngOf('position').as('lng'),
        'recorded_at',
        'is_online',
      ])
      .where('driver_id', '=', user.id)
      .executeTakeFirst();
    let previous: LocationPoint | null = current
      ? { lat: current.lat, lng: current.lng, recordedAt: new Date(current.recorded_at) }
      : null;

    const activeTrip = await this.db
      .selectFrom('trips')
      .select(['id', 'passenger_id', 'status'])
      .where('driver_id', '=', user.id)
      .where('status', 'in', ACTIVE_STATUSES)
      .executeTakeFirst();

    const accepted: Point[] = [];
    const rejected: Record<string, number> = {};
    for (const p of points) {
      if (previous && p.recordedAt <= previous.recordedAt) {
        rejected.duplicate = (rejected.duplicate ?? 0) + 1;
        continue;
      }
      const verdict = judgePoint(toPoint(p), previous, now);
      // Slightly old points are still useful as trip history, but never as the live position.
      if (verdict === 'ok' || (verdict === 'too_old' && activeTrip)) {
        accepted.push(p);
        if (verdict === 'ok') previous = toPoint(p);
      } else {
        rejected[verdict] = (rejected[verdict] ?? 0) + 1;
      }
    }

    const latestLive = [...accepted]
      .reverse()
      .find((p) => judgePoint(toPoint(p), null, now) === 'ok');
    if (latestLive) await this.upsertCurrent(user.id, latestLive, current?.is_online ?? false);

    if (activeTrip && accepted.length > 0) {
      await this.db
        .insertInto('trip_locations')
        .values(
          accepted.map((p) => ({
            trip_id: activeTrip.id,
            driver_id: user.id,
            position: geoPoint(p),
            recorded_at: p.recordedAt,
          })),
        )
        .execute();
      if (latestLive) {
        this.events.emit('driver.location', {
          tripId: activeTrip.id,
          passengerId: activeTrip.passenger_id,
          lat: latestLive.lat,
          lng: latestLive.lng,
          recordedAt: latestLive.recordedAt,
        });
      }
    }

    if (rejected.mocked) {
      // Visible to staff in the logs; repeated reports are grounds to review the driver.
      this.logger.warn({ driverId: user.id, points: rejected.mocked }, 'Mock location reported');
    }
    return { accepted: accepted.length, rejected };
  }

  private async upsertCurrent(driverId: string, p: Point, online: boolean): Promise<void> {
    const values = {
      position: geoPoint(p),
      heading: p.heading === undefined ? null : Math.round(p.heading) % 360,
      speed_kmh: p.speedKmh ?? null,
      accuracy_m: p.accuracyM ?? null,
      recorded_at: p.recordedAt,
      is_online: online,
    };
    await this.db
      .insertInto('driver_locations')
      .values({ driver_id: driverId, ...values })
      .onConflict((oc) =>
        oc
          .column('driver_id')
          .doUpdateSet(values)
          // Never let an older point overwrite a newer one (requests can arrive out of order).
          .where(sql<boolean>`driver_locations.recorded_at <= excluded.recorded_at`),
      )
      .execute();
  }
}

function toPoint(p: Point): LocationPoint {
  return {
    lat: p.lat,
    lng: p.lng,
    recordedAt: p.recordedAt,
    ...(p.accuracyM !== undefined ? { accuracyM: p.accuracyM } : {}),
    ...(p.mocked ? { mocked: true } : {}),
  };
}

function rejectPoint(verdict: PointVerdict): AppError {
  const messages: Record<PointVerdict, string> = {
    ok: '',
    mocked: 'A mock-location app is faking your position. Turn it off to drive with Musride.',
    inaccurate: 'Your GPS signal is weak. Move to an open area and try again.',
    future: 'Your phone clock is wrong. Turn on automatic date and time.',
    too_old: 'Your location is out of date. Wait for GPS and try again.',
    implausible_jump: 'Your location looks incorrect. Turn off any mock-location apps.',
  };
  return new AppError(
    HttpStatus.UNPROCESSABLE_ENTITY,
    `LOCATION_${verdict.toUpperCase()}`,
    messages[verdict],
  );
}
