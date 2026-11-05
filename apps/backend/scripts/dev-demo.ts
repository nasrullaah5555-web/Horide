/**
 * DEVELOPMENT ONLY — starts the API on :3000 and fills a local database with sample activity,
 * created through the real HTTP API (the same endpoints the apps use). Used to look at and test
 * the admin dashboard. Refuses to run in production or against a non-local database.
 *
 *   pnpm --filter @musride/backend demo
 *
 * Everything created is clearly marked: names start with "Demo", plates with "DEMO-".
 * Sign-in details for a demo staff account are written to .demo-admin.json (git-ignored).
 */
import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql, type Kysely } from 'kysely';
import { createApp } from '../src/bootstrap';
import { loadConfig } from '../src/config/env';
import { DATABASE } from '../src/database/database.module';
import { assertMigrationSuccess, createMigrator } from '../src/database/migrator';
import { seedDevelopment } from '../src/database/seed-dev';
import type { DB } from '../src/database/types';
import { AdminAccountsService } from '../src/modules/admin-auth/admin-accounts.service';
import { totpCode, totpStep } from '../src/modules/admin-auth/crypto';
import { FakeSmsProvider, SMS_PROVIDER } from '../src/modules/auth/sms/sms.provider';
import { MatchingService } from '../src/modules/trips/matching.service';

const BASE = 'http://127.0.0.1:3000';
// A minimal valid JPEG header followed by filler bytes: enough for the server's content check.
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2048, 7)]);

/** Places in Jijiga (approximate coordinates, for demonstration only). */
const PLACES = [
  { text: 'Taiwan Market', lat: 9.3505, lng: 42.7979 },
  { text: 'Jijiga University', lat: 9.3655, lng: 42.8079 },
  { text: 'Karamara Hospital', lat: 9.3432, lng: 42.7905 },
  { text: 'Bus station', lat: 9.3561, lng: 42.7884 },
  { text: 'Sheik Hassan Yabare Stadium', lat: 9.3612, lng: 42.7991 },
  { text: 'Airport road', lat: 9.3318, lng: 42.8123 },
];

let ipCounter = 1;

// Dev script: response shapes are checked by the API tests; here they are used loosely.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function call<T = any>(
  path: string,
  opts: {
    method?: string;
    token?: string;
    cookie?: string;
    csrf?: string;
    body?: unknown;
    form?: FormData;
  } = {},
): Promise<T> {
  const headers: Record<string, string> = { 'X-Forwarded-For': `10.99.0.${ipCounter++ % 250}` };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.cookie) headers.Cookie = opts.cookie;
  if (opts.csrf) headers['X-CSRF-Token'] = opts.csrf;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? (opts.body !== undefined || opts.form ? 'POST' : 'GET'),
    headers,
    body: opts.form ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${opts.method ?? 'POST'} ${path} → ${res.status} ${text}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

async function main(): Promise<void> {
  const config = loadConfig({
    ...process.env,
    SMS_PROVIDER: 'fake',
    RATE_LIMIT_ENABLED: 'false',
    NODE_ENV: 'development',
  });
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(config.DATABASE_URL))
    throw new Error('dev-demo only runs against a local database.');

  const app = await createApp(config);
  const db = app.get<Kysely<DB>>(DATABASE);
  assertMigrationSuccess(await createMigrator(db).migrateToLatest());
  await seedDevelopment(db);
  await app.listen(3000, '127.0.0.1');
  const sms = app.get<FakeSmsProvider>(SMS_PROVIDER);
  const matching = app.get(MatchingService);

  const already = await db
    .selectFrom('vehicles')
    .select('id')
    .where('plate_number', 'like', 'DEMO-%')
    .executeTakeFirst();

  // Demo staff account with every role, so every screen can be inspected.
  const email = 'demo.admin@musride.local';
  await db
    .deleteFrom('admin_users')
    .where('email', '=', email)
    .execute()
    .catch(() => undefined);
  const creds = await app.get(AdminAccountsService).create(
    {
      email,
      fullName: 'Demo Admin',
      roles: ['super', 'operations', 'finance', 'verification', 'support'],
    },
    { id: null },
  );
  writeFileSync(
    join(__dirname, '..', '.demo-admin.json'),
    JSON.stringify(
      { email, password: creds.temporaryPassword, totpSecret: creds.totpSecret },
      null,
      2,
    ),
  );

  const login = await fetch(`${BASE}/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: creds.temporaryPassword,
      totpCode: totpCode(creds.totpSecret, totpStep()),
    }),
  });
  const adminCookie = (login.headers.get('set-cookie') ?? '').split(';')[0]!;
  const { csrfToken } = (await login.json()) as { csrfToken: string };
  const admin = { cookie: adminCookie, csrf: csrfToken };
  // Allow the dashboard to sign in with the same TOTP step right after.
  await sql`UPDATE admin_users SET totp_last_step = NULL WHERE email = ${email}`.execute(db);

  async function userLogin(role: 'passenger' | 'driver', phone: string) {
    const req = await call<{ challengeId: string }>('/auth/otp/request', { body: { phone } });
    const code = sms.lastCodeFor(phone)!;
    await sql`UPDATE otp_challenges SET created_at = created_at - interval '2 minutes' WHERE phone = ${phone}`.execute(
      db,
    );
    return call<{ accessToken: string; user: { id: string } }>('/auth/otp/verify', {
      body: { challengeId: req.challengeId, code, role },
    });
  }

  const drivers: { id: string; token: string; lat: number; lng: number }[] = [];
  if (!already) {
    const plan = await call('/admin/subscription-plans', {
      ...admin,
      body: { name: 'Demo monthly', price: 500, durationDays: 30 },
    });
    const names = [
      'Demo Abdi Yusuf',
      'Demo Hamza Ali',
      'Demo Faisal Omar',
      'Demo Mustafe Ahmed',
      'Demo Ifrah Hassan',
      'Demo Kadar Ismail',
    ];
    for (const [i, name] of names.entries()) {
      const phone = `+25191${String(1000000 + i).slice(1)}0`;
      const d = await userLogin('driver', phone);
      await call('/driver/profile', {
        method: 'PATCH',
        token: d.accessToken,
        body: { fullName: name },
      });
      const vehicle = await call<{ id: string }>('/driver/vehicles', {
        token: d.accessToken,
        body: {
          category: i % 3 === 2 ? 'bajaj' : 'car',
          make: i % 3 === 2 ? 'Bajaj' : 'Toyota',
          model: i % 3 === 2 ? 'RE' : 'Vitz',
          colour: ['White', 'Silver', 'Blue'][i % 3],
          year: 2012 + i,
          plateNumber: `DEMO-${100 + i}`,
        },
      });
      for (const type of [
        'profile_photo',
        'national_id',
        'driving_licence',
        'vehicle_registration',
      ]) {
        const form = new FormData();
        form.set('type', type);
        if (type === 'vehicle_registration') form.set('vehicleId', vehicle.id);
        form.set('file', new Blob([JPEG], { type: 'image/jpeg' }), `${type}.jpg`);
        await call('/driver/documents', { token: d.accessToken, form });
      }
      // The last driver is left waiting for review, so the verification screens have work in them.
      if (i < names.length - 1) {
        const detail = await call<{ documents: { id: string }[] }>(
          `/admin/drivers/${d.user.id}`,
          admin,
        );
        for (const doc of detail.documents)
          await call(`/admin/documents/${doc.id}/approve`, { ...admin, body: {} });
        await call(`/admin/vehicles/${vehicle.id}/approve`, { ...admin, body: {} });
        await call(`/admin/drivers/${d.user.id}/approve`, { ...admin, body: {} });
        await call('/admin/subscriptions', {
          ...admin,
          body: {
            driverId: d.user.id,
            planId: plan.id,
            amount: 500,
            method: i % 2 ? 'ebirr' : 'cash',
            reference: i % 2 ? `EB${4400 + i}` : undefined,
            receivedAt: new Date().toISOString(),
          },
        });
        const pos = { lat: 9.35 + i * 0.003, lng: 42.795 + (i % 3) * 0.004 };
        await call('/driver/availability', {
          token: d.accessToken,
          body: {
            online: true,
            position: { ...pos, recordedAt: new Date().toISOString(), accuracyM: 8 },
          },
        });
        drivers.push({ id: d.user.id, token: d.accessToken, ...pos });
      }
    }

    const passengers = [];
    for (let i = 0; i < 8; i++) {
      const p = await userLogin('passenger', `+25192${String(1000000 + i).slice(1)}0`);
      await call('/passenger/profile', {
        method: 'PATCH',
        token: p.accessToken,
        body: { fullName: `Demo Passenger ${i + 1}` },
      });
      passengers.push(p);
    }

    // A mix of finished, live and failed rides.
    for (const [i, p] of passengers.entries()) {
      const from = PLACES[i % PLACES.length]!;
      const to = PLACES[(i + 2) % PLACES.length]!;
      const category = i === 5 ? 'bajaj' : 'car';
      const q = await call<{ quotes: { quoteToken: string }[] }>('/quotes', {
        token: p.accessToken,
        body: {
          pickup: { lat: from.lat, lng: from.lng },
          destination: { lat: to.lat, lng: to.lng },
          pickupText: from.text,
          destinationText: to.text,
          categories: [category],
          paymentMethod: i % 3 === 0 ? 'ebirr' : 'cash',
        },
      });
      const trip = await call<{ id: string }>('/trips', {
        token: p.accessToken,
        body: { quoteToken: q.quotes[0]!.quoteToken },
      });
      if (i === 7) continue; // left searching for a driver
      const offer = (
        await db
          .selectFrom('trip_offers')
          .select('driver_id')
          .where('trip_id', '=', trip.id)
          .where('status', '=', 'pending')
          .executeTakeFirst()
      )?.driver_id;
      const driver = drivers.find((d) => d.id === offer);
      if (!driver) continue;
      await call(`/trips/${trip.id}/accept`, { method: 'POST', token: driver.token });
      if (i === 6) continue; // driver on the way
      await call(`/trips/${trip.id}/arrived`, { method: 'POST', token: driver.token });
      await call(`/trips/${trip.id}/start`, { method: 'POST', token: driver.token });
      if (i === 4) continue; // ride in progress
      await call(`/trips/${trip.id}/complete`, { method: 'POST', token: driver.token });
      const ebirr = i % 3 === 0;
      await call(`/trips/${trip.id}/payment/received`, {
        token: driver.token,
        body: ebirr ? { method: 'ebirr', ebirrReference: `FT26${3090 + i}` } : { method: 'cash' },
      });
      if (i === 1)
        await call(`/trips/${trip.id}/payment/dispute`, {
          token: p.accessToken,
          body: { note: 'Driver asked for 20 ETB more than the app price' },
        });
      else
        await call(`/trips/${trip.id}/payment/confirm`, { method: 'POST', token: p.accessToken });
      await call(`/trips/${trip.id}/rating`, {
        token: p.accessToken,
        body: { stars: [5, 4, 5, 3][i % 4] },
      });
      if (i === 2)
        await call('/complaints', {
          token: p.accessToken,
          body: {
            tripId: trip.id,
            category: 'safety',
            description: 'The driver was using his phone while driving on the airport road.',
          },
        });
      if (i === 3)
        await call('/complaints', {
          token: p.accessToken,
          body: {
            tripId: trip.id,
            category: 'vehicle',
            description: 'Seat belts in the back seat were not working.',
          },
        });
    }
    const inProgress = await db
      .selectFrom('trips')
      .select(['id', 'passenger_id'])
      .where('status', '=', 'in_progress')
      .executeTakeFirst();
    if (inProgress) {
      const p = passengers.find((x) => x.user.id === inProgress.passenger_id)!;
      await call('/emergency', {
        token: p.accessToken,
        body: { tripId: inProgress.id, position: { lat: 9.3561, lng: 42.7884 } },
      });
    }
    await matching.sweep();
  } else {
    // Re-use existing demo drivers: log them in again so the live map has fresh positions.
    const rows = await db
      .selectFrom('users as u')
      .innerJoin('driver_profiles as d', 'd.user_id', 'u.id')
      .select(['u.id', 'u.phone'])
      .where('d.full_name', 'like', 'Demo %')
      .where('d.approval_status', '=', 'approved')
      .execute();
    for (const [i, r] of rows.entries()) {
      if (!r.phone) continue; // deleted account
      const d = await userLogin('driver', r.phone);
      const pos = { lat: 9.35 + i * 0.003, lng: 42.795 + (i % 3) * 0.004 };
      await call('/driver/availability', {
        token: d.accessToken,
        body: {
          online: true,
          position: { ...pos, recordedAt: new Date().toISOString(), accuracyM: 8 },
        },
      }).catch(() => undefined);
      drivers.push({ id: d.user.id, token: d.accessToken, ...pos });
    }
  }

  // Keep demo drivers "live" with small movements, like phones sending GPS every 10 seconds.
  setInterval(() => {
    for (const d of drivers) {
      d.lat += (Math.random() - 0.5) * 0.0004;
      d.lng += (Math.random() - 0.5) * 0.0004;
      void call('/driver/location', {
        token: d.token,
        body: {
          points: [{ lat: d.lat, lng: d.lng, recordedAt: new Date().toISOString(), accuracyM: 10 }],
        },
      }).catch(() => undefined);
    }
  }, 10_000);

  console.log(`\nDemo API running on ${BASE} with sample data.`);
  console.log(
    `Staff sign-in: ${email} (password and authenticator secret in apps/backend/.demo-admin.json)\n`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
