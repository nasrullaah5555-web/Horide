import { Kysely, sql } from 'kysely';
import type { DB, VehicleCategory } from '../../src/database/types';

/** Small builders for test data. Each call creates new, unique rows. */

let counter = 0;
const next = () => ++counter;

export function uniquePhone(): string {
  // +2519 followed by 8 digits; uses process id so parallel CI jobs don't collide.
  return `+2519${String((process.pid % 100) * 1_000_000 + next()).padStart(8, '0')}`;
}

/** Jijiga city centre (approximately). Used as a realistic default location in tests. */
export const JIJIGA = { lat: 9.3505, lng: 42.7979 };

export function point(lat: number, lng: number) {
  return sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography`;
}

export async function createAdmin(db: Kysely<DB>, email = `admin${next()}@test.local`) {
  return db
    .insertInto('admin_users')
    .values({
      email,
      full_name: 'Test Admin',
      password_hash: 'x',
      totp_secret_enc: null,
      locked_until: null,
      last_login_at: null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
}

export async function createPassenger(db: Kysely<DB>) {
  const user = await db
    .insertInto('users')
    .values({ phone: uniquePhone(), role: 'passenger', suspended_reason: null })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db
    .insertInto('passenger_profiles')
    .values({ user_id: user.id, full_name: 'Test Passenger', emergency_contact_phone: null })
    .execute();
  return user;
}

export async function createDriver(
  db: Kysely<DB>,
  opts: { approvedBy?: string; category?: VehicleCategory } = {},
) {
  const user = await db
    .insertInto('users')
    .values({ phone: uniquePhone(), role: 'driver', suspended_reason: null })
    .returning('id')
    .executeTakeFirstOrThrow();
  const approved = opts.approvedBy !== undefined;
  await db
    .insertInto('driver_profiles')
    .values({
      user_id: user.id,
      full_name: 'Test Driver',
      approval_status: approved ? 'approved' : 'pending',
      approved_by: opts.approvedBy ?? null,
      approved_at: approved ? new Date() : null,
    })
    .execute();
  const vehicle = await db
    .insertInto('vehicles')
    .values({
      driver_id: user.id,
      category: opts.category ?? 'car',
      make: 'Toyota',
      model: 'Vitz',
      colour: 'White',
      year: 2012,
      plate_number: `TST-${next()}${process.pid % 1000}`,
      approval_status: approved ? 'approved' : 'pending',
      approved_by: opts.approvedBy ?? null,
      approved_at: approved ? new Date() : null,
      rejection_reason: null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return { id: user.id, vehicleId: vehicle.id };
}

export async function createFareVersion(db: Kysely<DB>, category: VehicleCategory = 'car') {
  return db
    .insertInto('fare_versions')
    .values({
      category,
      base_fare: 4000,
      per_km: 1500,
      minimum_fare: 6000,
      rounding_unit: 500,
      note: 'test',
      created_by: null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
}

export async function createTrip(
  db: Kysely<DB>,
  opts: { passengerId: string; fareVersionId: string; category?: VehicleCategory },
) {
  return db
    .insertInto('trips')
    .values({
      passenger_id: opts.passengerId,
      category: opts.category ?? 'car',
      status: 'searching',
      pickup: point(JIJIGA.lat, JIJIGA.lng),
      destination: point(JIJIGA.lat + 0.01, JIJIGA.lng + 0.01),
      pickup_text: null,
      destination_text: null,
      route_distance_m: 2500,
      route_duration_s: 420,
      route_is_estimate: true,
      fare_version_id: opts.fareVersionId,
      quoted_fare: 8000,
      payment_method: 'cash',
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
    })
    .returning('id')
    .executeTakeFirstOrThrow();
}
