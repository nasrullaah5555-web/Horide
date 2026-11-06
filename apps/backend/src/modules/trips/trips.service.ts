import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Kysely, sql, Transaction } from 'kysely';
import { createHash, randomInt } from 'node:crypto';
import { DomainEvents } from '../../common/domain-events';
import { AppError } from '../../common/errors';
import { geoPoint } from '../../common/geo';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/env';
import { DATABASE } from '../../database/database.module';
import type { DB, TripParty, TripStatus } from '../../database/types';
import { DriverEligibilityService } from '../drivers/driver-eligibility.service';
import { verifyQuote } from '../pricing/quote-token';
import { AccountService } from '../users/account.service';
import { MatchingService } from './matching.service';
import { allowedFrom, type TripAction, TRANSITIONS } from './trip-state';

interface Actor {
  party: TripParty;
  id: string | null;
}

function isUniqueViolation(err: unknown, constraint: string): boolean {
  const e = err as { code?: string; constraint?: string };
  return e?.code === '23505' && e.constraint === constraint;
}

@Injectable()
export class TripsService {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly accounts: AccountService,
    private readonly eligibility: DriverEligibilityService,
    private readonly matching: MatchingService,
    private readonly events: DomainEvents,
  ) {}

  /**
   * Books a ride from a signed quote. The same quote always returns the same trip, so a retry
   * after a dropped connection never creates a second booking.
   */
  async request(
    passengerId: string,
    quoteToken: string,
  ): Promise<{ tripId: string; created: boolean }> {
    await this.accounts.requireActive(passengerId);
    const q = verifyQuote(quoteToken, this.config.QUOTE_SIGNING_SECRET);
    if (!q || q.pid !== passengerId) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'QUOTE_INVALID',
        'This price has expired. Please check the price again.',
      );
    }
    const quoteHash = createHash('sha256').update(quoteToken).digest('hex');

    const existing = await this.db
      .selectFrom('trips')
      .select('id')
      .where('quote_hash', '=', quoteHash)
      .executeTakeFirst();
    if (existing) return { tripId: existing.id, created: false };

    let tripId: string;
    try {
      tripId = await this.db.transaction().execute(async (trx) => {
        const trip = await trx
          .insertInto('trips')
          .values({
            passenger_id: passengerId,
            category: q.cat,
            status: 'searching',
            pickup: geoPoint({ lat: q.pu[0], lng: q.pu[1] }),
            pickup_text: q.put ?? null,
            destination: geoPoint({ lat: q.de[0], lng: q.de[1] }),
            destination_text: q.det ?? null,
            route_distance_m: q.dm,
            route_duration_s: q.ds,
            route_is_estimate: q.est,
            fare_version_id: q.fv,
            quoted_fare: q.fare,
            payment_method: q.pay,
            quote_hash: quoteHash,
            driver_id: null,
            vehicle_id: null,
            locked_fare: null,
            final_fare: null,
            accepted_at: null,
            arrived_at: null,
            started_at: null,
            completed_at: null,
            cancelled_at: null,
            cancelled_by: null,
            cancel_reason: null,
            cancellation_fee: null,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await this.recordEvent(trx, trip.id, null, 'searching', {
          party: 'passenger',
          id: passengerId,
        });
        return trip.id;
      });
    } catch (err) {
      if (isUniqueViolation(err, 'trips_one_open_per_passenger')) {
        throw new AppError(
          HttpStatus.CONFLICT,
          'TRIP_ALREADY_OPEN',
          'You already have a ride in progress.',
        );
      }
      if (isUniqueViolation(err, 'trips_quote_hash_unique')) {
        const again = await this.db
          .selectFrom('trips')
          .select('id')
          .where('quote_hash', '=', quoteHash)
          .executeTakeFirstOrThrow();
        return { tripId: again.id, created: false };
      }
      throw err;
    }

    this.events.emit('trip.updated', { tripId, passengerId, driverId: null, status: 'searching' });
    await this.matching.advance(tripId);
    return { tripId, created: true };
  }

  /**
   * A driver accepts an offer. Exactly one driver can win: the update only succeeds while the
   * trip is still searching with no driver, and the database allows one active trip per driver.
   * Eligibility is re-checked here, not trusted from the moment the offer was sent.
   */
  async accept(driverId: string, tripId: string): Promise<void> {
    const offer = await this.db
      .selectFrom('trip_offers')
      .select(['id', 'status', 'expires_at'])
      .where('trip_id', '=', tripId)
      .where('driver_id', '=', driverId)
      .executeTakeFirst();
    if (!offer) throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Ride request not found.');
    if (offer.status !== 'pending' || new Date(offer.expires_at).getTime() <= Date.now()) {
      throw new AppError(
        HttpStatus.CONFLICT,
        'OFFER_CLOSED',
        'This ride request is no longer available.',
      );
    }

    const check = await this.eligibility.evaluate(driverId);
    if (!check.eligible || !check.vehicle) {
      throw new AppError(
        HttpStatus.FORBIDDEN,
        'NOT_ELIGIBLE',
        'You cannot accept rides right now.',
        { reasons: check.reasons },
      );
    }
    const vehicle = check.vehicle;

    let result: { passengerId: string; losers: string[] };
    try {
      result = await this.db.transaction().execute(async (trx) => {
        const won = await trx
          .updateTable('trips')
          .set({
            status: 'accepted',
            driver_id: driverId,
            vehicle_id: vehicle.id,
            locked_fare: sql`quoted_fare`, // the fare is locked at acceptance (FR-07)
            accepted_at: sql`now()`,
            // Shown only to the passenger; the driver enters it to start the trip.
            start_pin: newRidePin(),
            start_pin_failures: 0,
          })
          .where('id', '=', tripId)
          .where('status', '=', 'searching')
          .where('driver_id', 'is', null)
          .where('category', '=', vehicle.category)
          .returning(['passenger_id'])
          .executeTakeFirst();
        if (!won)
          throw new AppError(
            HttpStatus.CONFLICT,
            'TRIP_TAKEN',
            'Another driver already accepted this ride.',
          );

        const closed = await trx
          .updateTable('trip_offers')
          .set((eb) => ({
            status: eb
              .case()
              .when('driver_id', '=', driverId)
              .then(sql<'accepted'>`'accepted'::offer_status`)
              .else(sql<'cancelled'>`'cancelled'::offer_status`)
              .end(),
            responded_at: sql`now()`,
          }))
          .where('trip_id', '=', tripId)
          .where('status', '=', 'pending')
          .returning('driver_id')
          .execute();
        await this.recordEvent(trx, tripId, 'searching', 'accepted', {
          party: 'driver',
          id: driverId,
        });
        return {
          passengerId: won.passenger_id,
          losers: closed.map((c) => c.driver_id).filter((d) => d !== driverId),
        };
      });
    } catch (err) {
      if (isUniqueViolation(err, 'trips_one_active_per_driver')) {
        throw new AppError(HttpStatus.CONFLICT, 'DRIVER_BUSY', 'Finish your current ride first.');
      }
      throw err;
    }

    if (result.losers.length)
      this.events.emit('offer.closed', { tripId, driverIds: result.losers, reason: 'taken' });
    this.events.emit('trip.updated', {
      tripId,
      passengerId: result.passengerId,
      driverId,
      status: 'accepted',
    });
  }

  async reject(driverId: string, tripId: string): Promise<void> {
    const updated = await this.db
      .updateTable('trip_offers')
      .set({ status: 'rejected', responded_at: sql`now()` })
      .where('trip_id', '=', tripId)
      .where('driver_id', '=', driverId)
      .where('status', '=', 'pending')
      .returning('id')
      .executeTakeFirst();
    if (!updated)
      throw new AppError(
        HttpStatus.CONFLICT,
        'OFFER_CLOSED',
        'This ride request is no longer available.',
      );
    await this.matching.advance(tripId); // offer it to the next driver straight away
  }

  /**
   * Every other status change. The WHERE clause carries both the allowed previous statuses and
   * the ownership check, so a stale app or another user's request can never move the trip.
   */
  async transition(
    action: Exclude<TripAction, 'accept' | 'expire'>,
    actor: Actor,
    tripId: string,
    opts: { reason?: string; pin?: string } = {},
  ): Promise<TripStatus> {
    const from = allowedFrom(action, actor.party);
    const to = TRANSITIONS[action].to;
    if (from.length === 0)
      throw new AppError(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'You cannot do this.');

    const outcome = await this.db.transaction().execute(async (trx) => {
      const current = await trx
        .selectFrom('trips')
        .select([
          'status',
          'passenger_id',
          'driver_id',
          'locked_fare',
          'payment_method',
          'fare_version_id',
          'arrived_at',
          'start_pin',
          'start_pin_failures',
        ])
        .where('id', '=', tripId)
        .forUpdate()
        .executeTakeFirst();
      const owns =
        current &&
        (actor.party === 'admin' ||
          actor.party === 'system' ||
          (actor.party === 'passenger' && current.passenger_id === actor.id) ||
          (actor.party === 'driver' && current.driver_id === actor.id));
      if (!current || !owns)
        throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Trip not found.');
      if (!from.includes(current.status)) {
        throw new AppError(
          HttpStatus.CONFLICT,
          'INVALID_TRIP_STATE',
          'This action is not possible right now.',
          {
            status: current.status,
          },
        );
      }

      // Starting needs the passenger's ride PIN. A wrong PIN is counted (and kept, so the
      // transaction must not roll it back) and the start is refused after the transaction.
      if (action === 'start' && current.start_pin) {
        if (current.start_pin_failures >= MAX_PIN_FAILURES) {
          return { pinProblem: 'locked' as const };
        }
        if (opts.pin !== current.start_pin) {
          await trx
            .updateTable('trips')
            .set({ start_pin_failures: current.start_pin_failures + 1 })
            .where('id', '=', tripId)
            .execute();
          return {
            pinProblem: 'wrong' as const,
            left: MAX_PIN_FAILURES - current.start_pin_failures - 1,
          };
        }
      }

      const now = sql`now()`;
      const set: Record<string, unknown> = { status: to };
      // The PIN has done its job once the trip starts, ends or is cancelled.
      if (to === 'in_progress' || to === 'completed' || to === 'cancelled') set.start_pin = null;
      if (to === 'arrived') set.arrived_at = now;
      if (to === 'in_progress') set.started_at = now;
      if (to === 'completed') {
        set.completed_at = now;
        set.final_fare = current.locked_fare;
      }
      if (to === 'cancelled') {
        set.cancelled_at = now;
        set.cancelled_by = actor.party;
        set.cancel_reason = opts.reason ?? null;
        set.cancellation_fee = await this.cancellationFee(trx, current, actor.party);
      }
      await trx
        .updateTable('trips')
        .set(set)
        .where('id', '=', tripId)
        .where('status', '=', current.status)
        .execute();

      if (to === 'cancelled') {
        await trx
          .updateTable('trip_offers')
          .set({ status: 'cancelled' })
          .where('trip_id', '=', tripId)
          .where('status', '=', 'pending')
          .execute();
      }
      if (to === 'completed') {
        // A payment RECORD; Musride never receives the money (BR-01).
        await trx
          .insertInto('payments')
          .values({
            trip_id: tripId,
            method: current.payment_method,
            amount: current.locked_fare!,
            ebirr_reference: null,
            driver_recorded_at: null,
            resolved_by: null,
            resolution_note: null,
          })
          .execute();
      }
      await this.recordEvent(
        trx,
        tripId,
        current.status,
        to,
        actor,
        opts.reason ? { reason: opts.reason } : null,
      );
      return { passengerId: current.passenger_id, driverId: current.driver_id };
    });

    if ('pinProblem' in outcome) {
      if (outcome.pinProblem === 'locked') {
        throw new AppError(
          HttpStatus.FORBIDDEN,
          'RIDE_PIN_LOCKED',
          'Too many wrong PINs. Call Musride support, or the passenger can cancel and book again.',
        );
      }
      const left = outcome.left ?? 0;
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'RIDE_PIN_WRONG',
        left > 0
          ? `That PIN is not right. Ask the passenger for the 4-digit PIN in their app (${left} tries left).`
          : 'That PIN is not right, and no tries are left. Call Musride support.',
        { triesLeft: left },
      );
    }

    this.events.emit('trip.updated', {
      tripId,
      passengerId: outcome.passengerId,
      driverId: outcome.driverId,
      status: to,
    });
    return to;
  }

  /**
   * A fee applies only when the passenger cancels after the driver has arrived, using the trip's
   * own fare version. The amount is an owner decision (OA-15) and is 0 until set.
   */
  private async cancellationFee(
    trx: Transaction<DB>,
    trip: { status: TripStatus; fare_version_id: string },
    party: TripParty,
  ): Promise<string | null> {
    if (party !== 'passenger' || trip.status !== 'arrived') return null;
    const v = await trx
      .selectFrom('fare_versions')
      .select('cancellation_fee')
      .where('id', '=', trip.fare_version_id)
      .executeTakeFirstOrThrow();
    return v.cancellation_fee;
  }

  private async recordEvent(
    trx: Transaction<DB>,
    tripId: string,
    from: TripStatus | null,
    to: TripStatus,
    actor: Actor,
    data: unknown = null,
  ): Promise<void> {
    await trx
      .insertInto('trip_events')
      .values({
        trip_id: tripId,
        from_status: from,
        to_status: to,
        actor_type: actor.party,
        actor_id: actor.id,
        data: data === null ? null : JSON.stringify(data),
      })
      .execute();
  }
}

/** Wrong ride PINs allowed per trip; 5 tries out of 10,000 PINs makes guessing pointless. */
export const MAX_PIN_FAILURES = 5;

/** A random 4-digit PIN, from the operating system's secure random source. */
export function newRidePin(): string {
  return randomInt(0, 10_000).toString().padStart(4, '0');
}
