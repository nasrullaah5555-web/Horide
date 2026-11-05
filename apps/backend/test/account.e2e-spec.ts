import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'kysely';
import { seedDevelopment } from '../src/database/seed-dev';
import { RetentionService } from '../src/modules/users/retention.service';
import { loginAs, startTestApp, type TestApp } from './helpers/app';
import { readyDriver } from './helpers/drivers';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(200, 2),
]);
const PICKUP = { lat: 9.3505, lng: 42.7979 };
const DEST = { lat: 9.3655, lng: 42.8079 };

describe('Account deletion and data retention (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await startTestApp();
    await seedDevelopment(t.db);
  });

  afterAll(async () => {
    await t.close();
  });

  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  it('needs an explicit confirmation', async () => {
    const p = await loginAs(t, 'passenger');
    await t.http().post('/account/delete').set(bearer(p.accessToken)).send({}).expect(400);
    await t
      .http()
      .post('/account/delete')
      .set(bearer(p.accessToken))
      .send({ confirm: 'yes' })
      .expect(400);
    await t.http().post('/account/delete').send({ confirm: true }).expect(401);
  });

  it('removes a passenger’s personal data, ends every session, and lets the phone register again', async () => {
    const p = await loginAs(t, 'passenger');
    await t
      .http()
      .patch('/passenger/profile')
      .set(bearer(p.accessToken))
      .send({ fullName: 'Hodan Ali', emergencyContactPhone: '0911223344' })
      .expect(200);
    await t
      .http()
      .post('/passenger/saved-locations')
      .set(bearer(p.accessToken))
      .send({ label: 'Home', position: PICKUP })
      .expect(201);

    await t
      .http()
      .post('/account/delete')
      .set(bearer(p.accessToken))
      .send({ confirm: true })
      .expect(200, { deleted: true });

    const user = await t.db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', p.user.id)
      .executeTakeFirstOrThrow();
    expect(user.status).toBe('deleted');
    expect(user.phone).toBeNull();
    expect(user.deleted_at).not.toBeNull();
    const profile = await t.db
      .selectFrom('passenger_profiles')
      .selectAll()
      .where('user_id', '=', p.user.id)
      .executeTakeFirstOrThrow();
    expect(profile.full_name).toBeNull();
    expect(profile.emergency_contact_phone).toBeNull();
    const places = await t.db
      .selectFrom('saved_locations')
      .select('id')
      .where('passenger_id', '=', p.user.id)
      .execute();
    expect(places).toHaveLength(0);

    // The refresh token no longer works, and actions with the old access token are refused.
    await t.http().post('/auth/refresh').send({ refreshToken: p.refreshToken }).expect(401);
    await t
      .http()
      .patch('/passenger/profile')
      .set(bearer(p.accessToken))
      .send({ fullName: 'Again' })
      .expect(401);

    const audit = await t.db
      .selectFrom('audit_logs')
      .select('action')
      .where('entity_id', '=', p.user.id)
      .execute();
    expect(audit.map((a) => a.action)).toContain('passenger.account_deleted');

    // Same phone, new account (after the normal 60-second code resend wait).
    await sql`UPDATE otp_challenges SET created_at = now() - interval '2 minutes'
              WHERE phone = ${p.user.phone}`.execute(t.db);
    const again = await loginAs(t, 'passenger', p.user.phone);
    expect(again.user.id).not.toBe(p.user.id);
    expect(again.user.isNew).toBe(true);
  });

  it('refuses while a trip is open, and works once it is cancelled', async () => {
    await readyDriver(t, { lat: PICKUP.lat + 0.001, lng: PICKUP.lng });
    const p = await loginAs(t, 'passenger');
    const q = await t
      .http()
      .post('/quotes')
      .set(bearer(p.accessToken))
      .send({ pickup: PICKUP, destination: DEST, categories: ['car'], paymentMethod: 'cash' })
      .expect(200);
    const trip = await t
      .http()
      .post('/trips')
      .set(bearer(p.accessToken))
      .send({ quoteToken: q.body.quotes[0].quoteToken })
      .expect(201);

    const refused = await t
      .http()
      .post('/account/delete')
      .set(bearer(p.accessToken))
      .send({ confirm: true })
      .expect(409);
    expect(refused.body.error.code).toBe('TRIP_OPEN');

    await t
      .http()
      .post(`/trips/${trip.body.id}/cancel`)
      .set(bearer(p.accessToken))
      .send({})
      .expect(200);
    await t
      .http()
      .post('/account/delete')
      .set(bearer(p.accessToken))
      .send({ confirm: true })
      .expect(200);
    // The trip record itself is kept (business record), still pointing at the anonymous account.
    const kept = await t.db
      .selectFrom('trips')
      .select('passenger_id')
      .where('id', '=', trip.body.id)
      .executeTakeFirstOrThrow();
    expect(kept.passenger_id).toBe(p.user.id);
  });

  it('removes a driver’s identity documents (records and files), live location and vehicle use', async () => {
    const d = await readyDriver(t, { lat: 9.36, lng: 42.81 });
    const up = await t
      .http()
      .post('/driver/documents')
      .set(bearer(d.token))
      .field('type', 'national_id')
      .attach('file', PNG, 'id.png')
      .expect(201);
    const doc = await t.db
      .selectFrom('driver_documents')
      .select('storage_key')
      .where('id', '=', up.body.id)
      .executeTakeFirstOrThrow();
    const file = join(process.env.STORAGE_LOCAL_DIR!, doc.storage_key);
    expect(existsSync(file)).toBe(true);

    await t.http().post('/account/delete').set(bearer(d.token)).send({ confirm: true }).expect(200);

    const docs = await t.db
      .selectFrom('driver_documents')
      .select('id')
      .where('driver_id', '=', d.id)
      .execute();
    expect(docs).toHaveLength(0);
    expect(existsSync(file)).toBe(false);
    const loc = await t.db
      .selectFrom('driver_locations')
      .select('driver_id')
      .where('driver_id', '=', d.id)
      .execute();
    expect(loc).toHaveLength(0);
    const vehicle = await t.db
      .selectFrom('vehicles')
      .select('is_active')
      .where('id', '=', d.vehicleId)
      .executeTakeFirstOrThrow();
    expect(vehicle.is_active).toBe(false);
    const profile = await t.db
      .selectFrom('driver_profiles')
      .select('full_name')
      .where('user_id', '=', d.id)
      .executeTakeFirstOrThrow();
    expect(profile.full_name).toBeNull();
  });

  it('the database refuses a deleted account that still has a phone, or a live one without', async () => {
    const p = await loginAs(t, 'passenger');
    await expect(
      t.db
        .updateTable('users')
        .set({ status: 'deleted', deleted_at: new Date() })
        .where('id', '=', p.user.id)
        .execute(),
    ).rejects.toThrow(/users_phone_unless_deleted/);
    await expect(
      t.db.updateTable('users').set({ phone: null }).where('id', '=', p.user.id).execute(),
    ).rejects.toThrow(/users_phone_unless_deleted/);
  });

  it('retention removes old OTP challenges and ended sessions, keeps recent ones', async () => {
    const retention = t.app.get(RetentionService);
    const p = await loginAs(t, 'passenger');
    await sql`INSERT INTO otp_challenges (phone, purpose, code_hash, expires_at, created_at)
              VALUES ('+251911000001', 'login', 'x', now() - interval '40 days', now() - interval '40 days'),
                     ('+251911000002', 'login', 'y', now(), now())`.execute(t.db);
    await sql`INSERT INTO auth_sessions (user_id, family_id, refresh_token_hash, expires_at, revoked_at)
              VALUES (${p.user.id}, gen_random_uuid(), 'old-hash-1', now() - interval '60 days', NULL),
                     (${p.user.id}, gen_random_uuid(), 'old-hash-2', now() + interval '1 day', now() - interval '45 days')`.execute(
      t.db,
    );

    const result = await retention.purge();
    expect(result.otp).toBeGreaterThanOrEqual(1);
    expect(result.sessions).toBeGreaterThanOrEqual(2);

    const otps = await t.db.selectFrom('otp_challenges').select('phone').execute();
    expect(otps.map((o) => o.phone)).toContain('+251911000002');
    expect(otps.map((o) => o.phone)).not.toContain('+251911000001');
    // The current login session survives and still refreshes.
    await t.http().post('/auth/refresh').send({ refreshToken: p.refreshToken }).expect(200);
  });
});
