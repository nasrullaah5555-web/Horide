import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Kysely, sql, Transaction } from 'kysely';
import { DomainEvents, type DomainEventMap } from '../../common/domain-events';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/env';
import { DATABASE } from '../../database/database.module';
import type { DB } from '../../database/types';
import { LIVE_LOCATION_MAX_AGE_SECONDS } from '../locations/location-rules';

/** Search radius per wave. Later waves reach further when nobody nearby accepts. */
export const WAVE_RADII_METRES = [2000, 4000, 7000] as const;
export const DRIVERS_PER_WAVE = 3;
export const OFFER_TTL_SECONDS = 20;
/** After this long without an acceptance, the request expires and the passenger is told. */
export const MAX_SEARCH_SECONDS = 180;
const SWEEP_INTERVAL_MS = 5000;

type Emit = { [K in keyof DomainEventMap]: [K, DomainEventMap[K]] }[keyof DomainEventMap];

/**
 * Finds drivers for a searching trip and sends them offers in waves.
 * The eligibility rules here are the SQL form of DriverEligibilityService (BR-04):
 * online with a fresh position, active account, approved driver, approved vehicle of the
 * requested category, active subscription, not on a trip, no other offer pending.
 */
@Injectable()
export class MatchingService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(MatchingService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly events: DomainEvents,
  ) {}

  onModuleInit(): void {
    // Tests call sweep() directly so they control time.
    if (this.config.NODE_ENV === 'test') return;
    this.timer = setInterval(() => {
      this.sweep().catch((err: unknown) => this.logger.error({ err }, 'Matching sweep failed'));
    }, SWEEP_INTERVAL_MS);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Moves every searching trip forward: expire stale offers, send the next wave, or expire the trip. */
  async sweep(): Promise<void> {
    const trips = await this.db
      .selectFrom('trips')
      .select('id')
      .where('status', '=', 'searching')
      .limit(200)
      .execute();
    for (const t of trips) await this.advance(t.id);
  }

  async advance(tripId: string): Promise<void> {
    const emitted: Emit[] = [];
    await this.db.transaction().execute(async (trx) => {
      const trip = await trx
        .selectFrom('trips')
        .select(['id', 'status', 'passenger_id', 'category', 'search_wave', 'requested_at'])
        .where('id', '=', tripId)
        .forUpdate()
        .executeTakeFirst();
      if (!trip || trip.status !== 'searching') return;

      const expiredOffers = await trx
        .updateTable('trip_offers')
        .set({ status: 'expired' })
        .where('trip_id', '=', tripId)
        .where('status', '=', 'pending')
        .where('expires_at', '<=', sql<Date>`now()`)
        .returning('driver_id')
        .execute();
      if (expiredOffers.length) {
        emitted.push([
          'offer.closed',
          { tripId, driverIds: expiredOffers.map((o) => o.driver_id), reason: 'expired' },
        ]);
      }

      const pending = await trx
        .selectFrom('trip_offers')
        .select('id')
        .where('trip_id', '=', tripId)
        .where('status', '=', 'pending')
        .executeTakeFirst();
      if (pending) return; // still waiting for a driver to answer

      const searchingFor = (Date.now() - new Date(trip.requested_at).getTime()) / 1000;
      if (searchingFor >= MAX_SEARCH_SECONDS) {
        await this.expireTrip(trx, tripId);
        emitted.push([
          'trip.updated',
          { tripId, passengerId: trip.passenger_id, driverId: null, status: 'expired' },
        ]);
        return;
      }

      const wave = Math.min(trip.search_wave + 1, WAVE_RADII_METRES.length);
      const radius = WAVE_RADII_METRES[wave - 1]!;
      const drivers = await this.findDrivers(trx, tripId, trip.category, radius);
      await trx.updateTable('trips').set({ search_wave: wave }).where('id', '=', tripId).execute();
      if (drivers.length === 0) return; // try again on the next sweep; drivers may come online

      const expiresAt = new Date(Date.now() + OFFER_TTL_SECONDS * 1000);
      const offers = await trx
        .insertInto('trip_offers')
        .values(
          drivers.map((d) => ({
            trip_id: tripId,
            driver_id: d.driver_id,
            wave,
            distance_m: d.distance_m,
            expires_at: expiresAt,
          })),
        )
        .onConflict((oc) => oc.columns(['trip_id', 'driver_id']).doNothing())
        .returning(['id', 'driver_id'])
        .execute();
      for (const o of offers) {
        emitted.push([
          'offer.created',
          { offerId: o.id, tripId, driverId: o.driver_id, expiresAt },
        ]);
      }
    });
    for (const [name, payload] of emitted) this.events.emit(name as never, payload as never);
  }

  private async findDrivers(
    trx: Transaction<DB>,
    tripId: string,
    category: string,
    radius: number,
  ) {
    const { rows } = await sql<{ driver_id: string; distance_m: number }>`
      WITH pickup AS (SELECT pickup AS p FROM trips WHERE id = ${tripId})
      SELECT dl.driver_id, round(ST_Distance(dl.position, pickup.p))::int AS distance_m
      FROM driver_locations dl
      CROSS JOIN pickup
      JOIN users u ON u.id = dl.driver_id AND u.status = 'active'
      JOIN driver_profiles d ON d.user_id = dl.driver_id AND d.approval_status = 'approved'
      JOIN vehicles v ON v.driver_id = dl.driver_id AND v.approval_status = 'approved'
                     AND v.is_active AND v.category = ${category}::vehicle_category
      WHERE dl.is_online
        AND dl.recorded_at > now() - make_interval(secs => ${LIVE_LOCATION_MAX_AGE_SECONDS})
        AND ST_DWithin(dl.position, pickup.p, ${radius})
        AND EXISTS (SELECT 1 FROM subscriptions s WHERE s.driver_id = dl.driver_id AND s.status = 'active'
                    AND s.starts_at <= now() AND s.ends_at > now())
        AND NOT EXISTS (SELECT 1 FROM trips t WHERE t.driver_id = dl.driver_id
                        AND t.status IN ('accepted', 'driver_arriving', 'arrived', 'in_progress'))
        AND NOT EXISTS (SELECT 1 FROM trip_offers o WHERE o.driver_id = dl.driver_id
                        AND o.status = 'pending' AND o.expires_at > now())
        AND NOT EXISTS (SELECT 1 FROM trip_offers o WHERE o.driver_id = dl.driver_id AND o.trip_id = ${tripId})
      ORDER BY dl.position <-> pickup.p
      LIMIT ${DRIVERS_PER_WAVE}
    `.execute(trx);
    return rows;
  }

  private async expireTrip(trx: Transaction<DB>, tripId: string): Promise<void> {
    await trx
      .updateTable('trips')
      .set({ status: 'expired' })
      .where('id', '=', tripId)
      .where('status', '=', 'searching')
      .execute();
    await trx
      .insertInto('trip_events')
      .values({
        trip_id: tripId,
        from_status: 'searching',
        to_status: 'expired',
        actor_type: 'system',
        actor_id: null,
        data: null,
      })
      .execute();
  }
}
