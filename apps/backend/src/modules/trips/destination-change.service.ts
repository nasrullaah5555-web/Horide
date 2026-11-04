import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { DomainEvents } from '../../common/domain-events';
import { AppError } from '../../common/errors';
import { geoPoint, latOf, lngOf, type LatLng } from '../../common/geo';
import { DATABASE } from '../../database/database.module';
import type { DB } from '../../database/types';
import { formatEtb } from '../pricing/fare-engine';
import { PricingService } from '../pricing/pricing.service';
import { ACTIVE_STATUSES } from './trip-state';

/** A proposed new price must be approved within this time, or it lapses. */
export const DESTINATION_CHANGE_TTL_SECONDS = 120;

/**
 * Changing the destination after a driver has accepted (FR-08).
 * The new fare uses the trip's own fare version (the passenger keeps the prices they booked under),
 * is calculated by the server, and replaces the locked fare only when the passenger approves it.
 * Until then, the original destination and fare stay in force.
 */
@Injectable()
export class DestinationChangeService {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    private readonly pricing: PricingService,
    private readonly events: DomainEvents,
  ) {}

  async propose(
    passengerId: string,
    tripId: string,
    destination: LatLng,
    destinationText: string | null,
  ) {
    const trip = await this.db
      .selectFrom('trips')
      .select([
        'id',
        'status',
        'fare_version_id',
        'locked_fare',
        latOf('pickup').as('lat'),
        lngOf('pickup').as('lng'),
      ])
      .where('id', '=', tripId)
      .where('passenger_id', '=', passengerId)
      .executeTakeFirst();
    if (!trip) throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Trip not found.');
    if (!(ACTIVE_STATUSES as string[]).includes(trip.status)) {
      throw new AppError(
        HttpStatus.CONFLICT,
        'INVALID_TRIP_STATE',
        'The destination can only be changed after a driver accepts.',
      );
    }

    const route = await this.pricing.validatedRoute({ lat: trip.lat, lng: trip.lng }, destination);
    const newFare = await this.pricing.priceWithVersion(trip.fare_version_id, route.distanceMetres);

    return this.db.transaction().execute(async (trx) => {
      // Any earlier unanswered proposal is replaced by this one.
      await trx
        .updateTable('trip_destination_changes')
        .set({ status: 'expired' })
        .where('trip_id', '=', tripId)
        .where('status', '=', 'pending')
        .execute();
      const change = await trx
        .insertInto('trip_destination_changes')
        .values({
          trip_id: tripId,
          new_destination: geoPoint(destination),
          destination_text: destinationText,
          route_distance_m: route.distanceMetres,
          route_duration_s: route.durationSeconds,
          fare_version_id: trip.fare_version_id,
          new_fare: newFare.toString(),
          expires_at: sql`now() + make_interval(secs => ${DESTINATION_CHANGE_TTL_SECONDS})`,
          decided_at: null,
        })
        .returning(['id', 'new_fare', 'expires_at', 'route_distance_m'])
        .executeTakeFirstOrThrow();
      return {
        changeId: change.id,
        currentFare: trip.locked_fare,
        newFare: change.new_fare,
        newFareEtb: formatEtb(newFare),
        distanceMetres: change.route_distance_m,
        isEstimate: route.isEstimate,
        expiresAt: change.expires_at,
      };
    });
  }

  async decide(
    passengerId: string,
    tripId: string,
    changeId: string,
    approve: boolean,
  ): Promise<void> {
    const outcome = await this.db.transaction().execute(async (trx) => {
      const trip = await trx
        .selectFrom('trips')
        .select(['status', 'driver_id', 'locked_fare', 'destination_text'])
        .where('id', '=', tripId)
        .where('passenger_id', '=', passengerId)
        .forUpdate()
        .executeTakeFirst();
      if (!trip) throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Trip not found.');

      const change = await trx
        .selectFrom('trip_destination_changes')
        .selectAll()
        .where('id', '=', changeId)
        .where('trip_id', '=', tripId)
        .forUpdate()
        .executeTakeFirst();
      if (!change) throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Change not found.');
      if (change.status !== 'pending' || new Date(change.expires_at).getTime() <= Date.now()) {
        throw new AppError(
          HttpStatus.CONFLICT,
          'CHANGE_EXPIRED',
          'This price has expired. Request the change again.',
        );
      }
      if (!(ACTIVE_STATUSES as string[]).includes(trip.status)) {
        throw new AppError(
          HttpStatus.CONFLICT,
          'INVALID_TRIP_STATE',
          'This trip can no longer be changed.',
        );
      }

      await trx
        .updateTable('trip_destination_changes')
        .set({ status: approve ? 'approved' : 'rejected', decided_at: sql`now()` })
        .where('id', '=', changeId)
        .execute();
      if (!approve) return null;

      await trx
        .updateTable('trips')
        .set({
          destination: sql`${sql.ref('trip_destination_changes.new_destination')}`,
          destination_text: change.destination_text,
          route_distance_m: change.route_distance_m,
          route_duration_s: change.route_duration_s,
          locked_fare: change.new_fare,
        })
        .from('trip_destination_changes')
        .where('trips.id', '=', tripId)
        .where('trip_destination_changes.id', '=', changeId)
        .execute();
      await trx
        .insertInto('trip_events')
        .values({
          trip_id: tripId,
          from_status: trip.status,
          to_status: trip.status,
          actor_type: 'passenger',
          actor_id: passengerId,
          data: JSON.stringify({
            type: 'destination_changed',
            oldFare: trip.locked_fare,
            newFare: change.new_fare,
            oldDestination: trip.destination_text,
            newDestination: change.destination_text,
          }),
        })
        .execute();
      return { driverId: trip.driver_id, status: trip.status };
    });

    if (outcome) {
      this.events.emit('trip.updated', {
        tripId,
        passengerId,
        driverId: outcome.driverId,
        status: outcome.status,
      });
    }
  }
}
