import { Inject, Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { latOf, lngOf } from '../../common/geo';
import { DATABASE } from '../../database/database.module';
import type { DB, UserRole } from '../../database/types';
import { LIVE_LOCATION_MAX_AGE_SECONDS } from '../locations/location-rules';
import { ACTIVE_STATUSES, OPEN_STATUSES } from './trip-state';

/**
 * What each party is allowed to see about a trip.
 * Phone numbers of the other party are shared only while the trip is active (to call on arrival),
 * never afterwards in history.
 */
@Injectable()
export class TripViewsService {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  async forUser(tripId: string, viewer: { id: string; role: UserRole }) {
    const ownerColumn = viewer.role === 'passenger' ? 't.passenger_id' : 't.driver_id';
    const trip = await this.db
      .selectFrom('trips as t')
      .select([
        't.id',
        't.status',
        't.category',
        't.passenger_id',
        't.driver_id',
        't.vehicle_id',
        latOf('t.pickup').as('pickup_lat'),
        lngOf('t.pickup').as('pickup_lng'),
        't.pickup_text',
        latOf('t.destination').as('destination_lat'),
        lngOf('t.destination').as('destination_lng'),
        't.destination_text',
        't.route_distance_m',
        't.route_duration_s',
        't.route_is_estimate',
        't.quoted_fare',
        't.locked_fare',
        't.final_fare',
        't.payment_method',
        't.requested_at',
        't.accepted_at',
        't.arrived_at',
        't.started_at',
        't.completed_at',
        't.cancelled_at',
        't.cancelled_by',
        't.cancellation_fee',
        't.start_pin',
      ])
      .where('t.id', '=', tripId)
      .where(ownerColumn, '=', viewer.id) // ownership enforced in the query: no IDOR
      .executeTakeFirst();
    if (!trip) return null;

    const active = (ACTIVE_STATUSES as string[]).includes(trip.status);
    const view: Record<string, unknown> = {
      id: trip.id,
      status: trip.status,
      category: trip.category,
      pickup: { lat: trip.pickup_lat, lng: trip.pickup_lng, text: trip.pickup_text },
      destination: {
        lat: trip.destination_lat,
        lng: trip.destination_lng,
        text: trip.destination_text,
      },
      route: {
        distanceMetres: trip.route_distance_m,
        durationSeconds: trip.route_duration_s,
        isEstimate: trip.route_is_estimate,
      },
      fare: {
        quoted: trip.quoted_fare,
        locked: trip.locked_fare,
        final: trip.final_fare,
        cancellationFee: trip.cancellation_fee,
      },
      paymentMethod: trip.payment_method,
      times: {
        requestedAt: trip.requested_at,
        acceptedAt: trip.accepted_at,
        arrivedAt: trip.arrived_at,
        startedAt: trip.started_at,
        completedAt: trip.completed_at,
        cancelledAt: trip.cancelled_at,
      },
      cancelledBy: trip.cancelled_by,
    };
    // Only the passenger sees the ride PIN, and only until the trip starts. The driver must
    // hear it from the passenger, which proves they found each other.
    if (viewer.role === 'passenger' && trip.start_pin) view.startPin = trip.start_pin;

    if (viewer.role === 'passenger' && trip.driver_id) {
      const driver = await this.db
        .selectFrom('driver_profiles as d')
        .innerJoin('users as u', 'u.id', 'd.user_id')
        .innerJoin('vehicles as v', (j) => j.on('v.id', '=', trip.vehicle_id))
        .select([
          'd.full_name',
          'd.rating_avg',
          'd.rating_count',
          'u.phone',
          'v.make',
          'v.model',
          'v.colour',
          'v.plate_number',
          'v.category',
        ])
        .where('d.user_id', '=', trip.driver_id)
        .executeTakeFirst();
      if (driver) {
        view.driver = {
          name: driver.full_name,
          rating: driver.rating_avg,
          ratingCount: driver.rating_count,
          phone: active ? driver.phone : undefined,
          vehicle: {
            make: driver.make,
            model: driver.model,
            colour: driver.colour,
            plate: driver.plate_number,
            category: driver.category,
          },
        };
        if (active) view.driverLocation = await this.driverLocation(trip.driver_id);
      }
    }
    if (viewer.role === 'driver') {
      const passenger = await this.db
        .selectFrom('passenger_profiles as p')
        .innerJoin('users as u', 'u.id', 'p.user_id')
        .select(['p.full_name', 'u.phone'])
        .where('p.user_id', '=', trip.passenger_id)
        .executeTakeFirst();
      view.passenger = {
        name: passenger?.full_name ?? null,
        phone: active ? passenger?.phone : undefined,
      };
    }
    return view;
  }

  /** The driver's last position with its age. Old positions are labelled, never presented as live. */
  async driverLocation(driverId: string) {
    const loc = await this.db
      .selectFrom('driver_locations')
      .select([
        latOf('position').as('lat'),
        lngOf('position').as('lng'),
        'heading',
        'recorded_at',
        sql<number>`extract(epoch from (now() - recorded_at))::int`.as('age_seconds'),
      ])
      .where('driver_id', '=', driverId)
      .executeTakeFirst();
    if (!loc) return null;
    return {
      lat: loc.lat,
      lng: loc.lng,
      heading: loc.heading,
      recordedAt: loc.recorded_at,
      ageSeconds: loc.age_seconds,
      isLive: loc.age_seconds <= LIVE_LOCATION_MAX_AGE_SECONDS,
    };
  }

  /** The user's current open trip, for resynchronising after the app reconnects. */
  async activeTripId(viewer: { id: string; role: UserRole }): Promise<string | null> {
    const column = viewer.role === 'passenger' ? 'passenger_id' : 'driver_id';
    const statuses = viewer.role === 'passenger' ? OPEN_STATUSES : ACTIVE_STATUSES;
    const row = await this.db
      .selectFrom('trips')
      .select('id')
      .where(column, '=', viewer.id)
      .where('status', 'in', statuses)
      .orderBy('requested_at', 'desc')
      .executeTakeFirst();
    return row?.id ?? null;
  }

  async history(viewer: { id: string; role: UserRole }, before: Date | undefined, limit: number) {
    const column = viewer.role === 'passenger' ? 'passenger_id' : 'driver_id';
    let q = this.db
      .selectFrom('trips')
      .select([
        'id',
        'status',
        'category',
        'pickup_text',
        'destination_text',
        'final_fare',
        'locked_fare',
        'quoted_fare',
        'payment_method',
        'requested_at',
        'completed_at',
      ])
      .where(column, '=', viewer.id)
      .orderBy('requested_at', 'desc')
      .limit(limit);
    if (before) q = q.where('requested_at', '<', before);
    return q.execute();
  }

  async pendingOffers(driverId: string) {
    return this.db
      .selectFrom('trip_offers as o')
      .innerJoin('trips as t', 't.id', 'o.trip_id')
      .select([
        'o.id as offer_id',
        'o.trip_id',
        'o.expires_at',
        'o.distance_m as distance_to_pickup_m',
        't.category',
        't.pickup_text',
        latOf('t.pickup').as('pickup_lat'),
        lngOf('t.pickup').as('pickup_lng'),
        't.destination_text',
        't.route_distance_m',
        't.quoted_fare',
        't.payment_method',
      ])
      .where('o.driver_id', '=', driverId)
      .where('o.status', '=', 'pending')
      .where('o.expires_at', '>', sql<Date>`now()`)
      .where('t.status', '=', 'searching')
      .execute();
  }
}
