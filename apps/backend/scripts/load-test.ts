/**
 * DEVELOPMENT ONLY — load test for location ingestion and matching (T-044).
 *
 *   pnpm --filter @musride/backend build
 *   pnpm --filter @musride/backend load-test            # 200 drivers, 60 passengers, 60 s
 *   LOAD_DRIVERS=400 LOAD_PASSENGERS=120 LOAD_SECONDS=120 pnpm --filter @musride/backend load-test
 *
 * 1. Prepares accounts directly in a LOCAL database (refuses anything else): eligible drivers
 *    spread over Jijiga, and passengers. Names start with "Load"; plates with "LOAD-".
 * 2. Starts the built API (dist/main.js) as a separate process on port 3100, so the load
 *    generator doesn't share the server's CPU thread.
 * 3. Drivers behave like the driver app: a location every 5 s, offers checked every 3 s,
 *    accept → arrived → start → complete. Passengers quote, book and wait for a driver, again
 *    and again.
 * 4. Prints latency percentiles per endpoint, error counts and booking-to-acceptance times.
 *
 * Results describe THIS machine with a local database. They are a smoke test for bottlenecks,
 * not a prediction of production capacity.
 */
import 'reflect-metadata';
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { sql, type Kysely } from 'kysely';
import { createApp } from '../src/bootstrap';
import { loadConfig } from '../src/config/env';
import { createDatabase } from '../src/database/database';
import { DATABASE } from '../src/database/database.module';
import { assertMigrationSuccess, createMigrator } from '../src/database/migrator';
import { seedDevelopment } from '../src/database/seed-dev';
import type { DB } from '../src/database/types';
import { SessionService } from '../src/modules/auth/session.service';

// Local settings from .env (copied from .env.example), if present.
try {
  process.loadEnvFile(join(__dirname, '..', '.env'));
} catch {
  // no .env: rely on the environment
}

const PORT = 3100;
const BASE = `http://127.0.0.1:${PORT}`;
const DRIVERS = Number(process.env.LOAD_DRIVERS ?? 200);
const PASSENGERS = Number(process.env.LOAD_PASSENGERS ?? 60);
const SECONDS = Number(process.env.LOAD_SECONDS ?? 60);

/** Approximate Jijiga centre and the box drivers and passengers are spread over (about 4 × 4 km). */
const CENTRE = { lat: 9.3505, lng: 42.7979 };
const SPREAD = 0.018;
const rand = (spread = SPREAD) => (Math.random() - 0.5) * 2 * spread;
const point = () => ({ lat: CENTRE.lat + rand(), lng: CENTRE.lng + rand() });

// ---------------------------------------------------------------- metrics
const latencies = new Map<string, number[]>();
const statuses = new Map<string, number>();
const acceptTimes: number[] = [];
let tripsBooked = 0;
let tripsAccepted = 0;
let tripsExpired = 0;
let tripsCompleted = 0;
let acceptConflicts = 0;

async function call(
  name: string,
  path: string,
  token: string,
  body?: unknown,
): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const started = performance.now();
  let status: number;
  let json: Record<string, unknown> | null = null;
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    status = res.status;
    const text = await res.text();
    json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    status = 0; // connection error
  }
  const ms = performance.now() - started;
  if (!latencies.has(name)) latencies.set(name, []);
  latencies.get(name)!.push(ms);
  const key = `${name} ${status}`;
  statuses.set(key, (statuses.get(key) ?? 0) + 1);
  return { status, json };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- setup
async function prepare(): Promise<{
  drivers: { id: string; token: string; pos: { lat: number; lng: number } }[];
  passengers: { token: string }[];
}> {
  const config = loadConfig({ ...process.env, NODE_ENV: 'development', SMS_PROVIDER: 'fake' });
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(config.DATABASE_URL)) {
    throw new Error('The load test only runs against a local database.');
  }
  const app = await createApp(config);
  await app.init();
  const db = app.get<Kysely<DB>>(DATABASE);
  assertMigrationSuccess(await createMigrator(db).migrateToLatest());
  await seedDevelopment(db);
  const sessions = app.get(SessionService);

  // Clear earlier load-test runs: take their drivers offline and close their open trips.
  await sql`UPDATE driver_locations SET is_online = false`.execute(db);
  await sql`UPDATE trips SET status = 'cancelled', cancelled_at = now(), cancelled_by = 'admin'
            WHERE status IN ('requested','searching','accepted','driver_arriving','arrived','in_progress')`.execute(
    db,
  );

  const admin = await db
    .insertInto('admin_users')
    .values({
      email: `load-${Date.now()}@example.invalid`,
      full_name: 'Load test',
      password_hash: 'not-a-login',
      totp_secret_enc: null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const plan = await db
    .insertInto('subscription_plans')
    .values({ name: `Load plan ${Date.now()}`, category: null, price: 50000, duration_days: 30 })
    .returning('id')
    .executeTakeFirstOrThrow();

  const run = Date.now() % 1_000_000;
  const phone = (kind: number, i: number) =>
    `+2517${kind}${String(run % 100).padStart(2, '0')}${String(i).padStart(5, '0')}`;

  const drivers: { id: string; token: string; pos: { lat: number; lng: number } }[] = [];
  for (let i = 0; i < DRIVERS; i++) {
    const login = await sessions.login(phone(1, i), 'driver', 'load-test');
    const id = login.user.id;
    await db
      .updateTable('driver_profiles')
      .set({
        full_name: `Load Driver ${i}`,
        approval_status: 'approved',
        approved_by: admin.id,
        approved_at: new Date(),
      })
      .where('user_id', '=', id)
      .execute();
    const hasVehicle = await db
      .selectFrom('vehicles')
      .select('id')
      .where('driver_id', '=', id)
      .executeTakeFirst();
    if (!hasVehicle) {
      await db
        .insertInto('vehicles')
        .values({
          driver_id: id,
          category: i % 2 === 0 ? 'car' : 'bajaj',
          make: 'Load',
          model: 'Test',
          colour: 'Grey',
          year: 2018,
          plate_number: `LOAD-${run % 1000}-${i}`,
          approval_status: 'approved',
          approved_by: admin.id,
          approved_at: new Date(),
          rejection_reason: null,
        })
        .execute();
      await db
        .insertInto('subscriptions')
        .values({
          driver_id: id,
          plan_id: plan.id,
          starts_at: new Date(Date.now() - 86_400_000),
          ends_at: new Date(Date.now() + 29 * 86_400_000),
          created_by: admin.id,
        })
        .execute();
    }
    drivers.push({ id, token: login.accessToken, pos: point() });
  }
  const passengers: { token: string }[] = [];
  for (let i = 0; i < PASSENGERS; i++) {
    const login = await sessions.login(phone(2, i), 'passenger', 'load-test');
    passengers.push({ token: login.accessToken });
  }
  await app.close();
  return { drivers, passengers };
}

async function startServer(): Promise<ChildProcess> {
  const child = spawn(process.execPath, [join(__dirname, '..', 'dist', 'main.js')], {
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(PORT),
      LOG_LEVEL: 'warn',
      SMS_PROVIDER: 'fake',
      RATE_LIMIT_ENABLED: 'false', // the load comes from one IP; limits are tested separately
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/health`)).ok) return child;
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  child.kill();
  throw new Error('API did not start (run `pnpm --filter @musride/backend build` first).');
}

// ---------------------------------------------------------------- behaviour
async function driverLoop(
  d: { id: string; token: string; pos: { lat: number; lng: number } },
  until: number,
  db: Kysely<DB>,
) {
  const go = await call('POST /driver/availability', '/driver/availability', d.token, {
    online: true,
    position: { ...d.pos, recordedAt: new Date().toISOString(), accuracyM: 8 },
  });
  if (go.status !== 200) return;
  let nextLocation = Date.now() + Math.random() * 5000;
  let nextOffers = Date.now() + Math.random() * 3000;
  while (Date.now() < until) {
    const now = Date.now();
    if (now >= nextLocation) {
      d.pos = { lat: d.pos.lat + rand(0.0002), lng: d.pos.lng + rand(0.0002) }; // ~20 m drift
      await call('POST /driver/location', '/driver/location', d.token, {
        points: [{ ...d.pos, recordedAt: new Date().toISOString(), accuracyM: 8 }],
      });
      nextLocation = now + 5000;
    }
    if (now >= nextOffers) {
      nextOffers = now + 3000;
      const offers = await call('GET /driver/offers', '/driver/offers', d.token);
      const list = (offers.json?.offers as { trip_id: string }[] | undefined) ?? [];
      if (list.length > 0) {
        const tripId = list[0]!.trip_id;
        const acc = await call('POST /trips/:id/accept', `/trips/${tripId}/accept`, d.token, {});
        if (acc.status === 409) acceptConflicts++;
        if (acc.status === 200) {
          // The passenger would read out the ride PIN; the load test reads it from the database.
          const { start_pin: pin } = await db
            .selectFrom('trips')
            .select('start_pin')
            .where('id', '=', tripId)
            .executeTakeFirstOrThrow();
          for (const step of ['arrived', 'start', 'complete']) {
            await sleep(1000);
            await call(
              `POST /trips/:id/${step}`,
              `/trips/${tripId}/${step}`,
              d.token,
              step === 'start' ? { pin } : {},
            );
          }
          tripsCompleted++;
        }
      }
    }
    await sleep(200);
  }
  await call('POST /driver/availability', '/driver/availability', d.token, { online: false });
}

async function passengerLoop(p: { token: string }, until: number) {
  await sleep(Math.random() * 5000);
  while (Date.now() < until - 15_000) {
    const pickup = point();
    const destination = point();
    const category = Math.random() < 0.5 ? 'car' : 'bajaj';
    const q = await call('POST /quotes', '/quotes', p.token, {
      pickup,
      destination,
      categories: [category],
      paymentMethod: 'cash',
    });
    const quote = (q.json?.quotes as { quoteToken: string }[] | undefined)?.[0];
    if (q.status !== 200 || !quote) {
      await sleep(3000);
      continue;
    }
    const booked = await call('POST /trips', '/trips', p.token, { quoteToken: quote.quoteToken });
    if (booked.status !== 201) {
      await sleep(3000);
      continue;
    }
    tripsBooked++;
    const tripId = booked.json!.id as string;
    const started = Date.now();
    let accepted = false;
    while (Date.now() - started < 200_000 && Date.now() < until) {
      await sleep(2000);
      const t = await call('GET /trips/:id', `/trips/${tripId}`, p.token);
      const status = t.json?.status as string | undefined;
      if (!accepted && status && !['requested', 'searching'].includes(status)) {
        if (status !== 'cancelled' && status !== 'expired') {
          accepted = true;
          tripsAccepted++;
          acceptTimes.push(Date.now() - started);
        }
      }
      if (status === 'expired') {
        tripsExpired++;
        break;
      }
      if (status === 'completed' || status === 'cancelled') break;
    }
    await sleep(3000 + Math.random() * 5000);
  }
}

// ---------------------------------------------------------------- report
function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
}

function report(elapsedSeconds: number) {
  const rows = [...latencies.entries()].sort((a, b) => b[1].length - a[1].length);
  const total = rows.reduce((n, [, v]) => n + v.length, 0);
  console.log(
    `\nLoad test: ${DRIVERS} drivers, ${PASSENGERS} passengers, ${elapsedSeconds.toFixed(0)} s, ` +
      `${total} requests (${(total / elapsedSeconds).toFixed(1)} req/s)\n`,
  );
  console.log('endpoint                          count     p50     p95     p99     max  (ms)');
  for (const [name, values] of rows) {
    const s = [...values].sort((a, b) => a - b);
    console.log(
      `${name.padEnd(32)} ${String(s.length).padStart(6)} ${pct(s, 50).toFixed(0).padStart(7)} ` +
        `${pct(s, 95).toFixed(0).padStart(7)} ${pct(s, 99).toFixed(0).padStart(7)} ${s[s.length - 1]!.toFixed(0).padStart(7)}`,
    );
  }
  console.log('\nresponses by status:');
  for (const [k, v] of [...statuses.entries()].sort()) console.log(`  ${k.padEnd(40)} ${v}`);
  const acc = [...acceptTimes].sort((a, b) => a - b);
  console.log(
    `\ntrips: booked ${tripsBooked}, accepted ${tripsAccepted}, completed by drivers ${tripsCompleted}, ` +
      `expired ${tripsExpired}, lost accept races (409) ${acceptConflicts}`,
  );
  if (acc.length) {
    console.log(
      `booking → accepted (s, includes 2 s polling): p50 ${(pct(acc, 50) / 1000).toFixed(1)}, ` +
        `p95 ${(pct(acc, 95) / 1000).toFixed(1)}, max ${(acc[acc.length - 1]! / 1000).toFixed(1)}`,
    );
  }
}

async function main() {
  console.log(`Preparing ${DRIVERS} drivers and ${PASSENGERS} passengers...`);
  const { drivers, passengers } = await prepare();
  const server = await startServer();
  // Only used to read ride PINs, which a real passenger would read out to the driver.
  const db = createDatabase({
    connectionString: loadConfig({ ...process.env, NODE_ENV: 'development' }).DATABASE_URL,
    ssl: false,
  });
  try {
    console.log(`Running for ${SECONDS} s...`);
    const started = Date.now();
    const until = started + SECONDS * 1000;
    await Promise.all([
      ...drivers.map((d) => driverLoop(d, until, db)),
      ...passengers.map((p) => passengerLoop(p, until)),
    ]);
    report((Date.now() - started) / 1000);
  } finally {
    server.kill();
    await db.destroy();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
