import { sql } from 'kysely';
import type { VehicleCategory } from '../../src/database/types';
import { loginAs, type TestApp } from './app';
import { createAdmin } from './fixtures';

let plate = 0;
let shared: Promise<{ planId: string; approverId: string }> | null = null;

/** One-time setup shared by all drivers. A cached promise, so parallel calls don't race to create it. */
function sharedSetup(t: TestApp) {
  shared ??= (async () => {
    const approverId = (await createAdmin(t.db)).id;
    const plan = await t.db
      .insertInto('subscription_plans')
      .values({
        name: `Test plan ${process.pid}-${Date.now()}`,
        category: null,
        price: 50000,
        duration_days: 30,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return { planId: plan.id, approverId };
  })();
  return shared;
}

/**
 * A driver who satisfies every eligibility rule: approved, approved vehicle, active subscription,
 * online at the given position with a fresh fix. Logs in through the real OTP flow.
 */
export async function readyDriver(
  t: TestApp,
  opts: { category?: VehicleCategory; lat: number; lng: number; online?: boolean },
) {
  const { planId, approverId } = await sharedSetup(t);

  const login = await loginAs(t, 'driver');
  const id = login.user.id;
  await t.db
    .updateTable('driver_profiles')
    .set({
      full_name: `Driver ${id.slice(0, 4)}`,
      approval_status: 'approved',
      approved_by: approverId,
      approved_at: new Date(),
    })
    .where('user_id', '=', id)
    .execute();
  const vehicle = await t.db
    .insertInto('vehicles')
    .values({
      driver_id: id,
      category: opts.category ?? 'car',
      make: 'Toyota',
      model: 'Vitz',
      colour: 'White',
      year: 2015,
      plate_number: `RD-${process.pid % 1000}-${++plate}`,
      approval_status: 'approved',
      approved_by: approverId,
      approved_at: new Date(),
      rejection_reason: null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const sub = await t.db
    .insertInto('subscriptions')
    .values({
      driver_id: id,
      plan_id: planId,
      starts_at: new Date(Date.now() - 86_400_000),
      ends_at: new Date(Date.now() + 29 * 86_400_000),
      created_by: approverId,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await sql`INSERT INTO driver_locations (driver_id, position, recorded_at, is_online)
            VALUES (${id}, ST_SetSRID(ST_MakePoint(${opts.lng}, ${opts.lat}), 4326)::geography, now(), ${opts.online ?? true})`.execute(
    t.db,
  );
  return { id, token: login.accessToken, vehicleId: vehicle.id, subscriptionId: sub.id };
}
