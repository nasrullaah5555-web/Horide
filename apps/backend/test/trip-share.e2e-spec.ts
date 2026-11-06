import { sql } from 'kysely';
import { seedDevelopment } from '../src/database/seed-dev';
import { loginAs, startTestApp, type TestApp } from './helpers/app';
import { readyDriver } from './helpers/drivers';

const PICKUP = { lat: 9.3505, lng: 42.7979 };
const DEST = { lat: 9.3655, lng: 42.8079 };

describe('Share my trip (e2e)', () => {
  let t: TestApp;
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    t = await startTestApp({ PUBLIC_WEB_URL: 'https://web.musride.test/' });
    await seedDevelopment(t.db);
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.db.updateTable('driver_locations').set({ is_online: false }).execute();
    await sql`UPDATE trips SET status = 'cancelled', cancelled_at = now(), cancelled_by = 'admin'
              WHERE status IN ('requested','searching','accepted','driver_arriving','arrived','in_progress')`.execute(
      t.db,
    );
  });

  async function acceptedTrip() {
    const d = await readyDriver(t, { lat: PICKUP.lat + 0.001, lng: PICKUP.lng });
    const p = await loginAs(t, 'passenger');
    const q = await t
      .http()
      .post('/quotes')
      .set(bearer(p.accessToken))
      .send({ pickup: PICKUP, destination: DEST, categories: ['car'], paymentMethod: 'cash' })
      .expect(200);
    const booked = await t
      .http()
      .post('/trips')
      .set(bearer(p.accessToken))
      .send({ quoteToken: q.body.quotes[0].quoteToken })
      .expect(201);
    const tripId = booked.body.id as string;
    await t.http().post(`/trips/${tripId}/accept`).set(bearer(d.token)).expect(200);
    return { tripId, p, d };
  }

  const tokenOf = (url: string) => url.split('#')[1]!;
  const view = (token: string) => t.http().post('/share/view').send({ token });

  it('a passenger shares a link; the viewer sees the car and position, but no phone numbers', async () => {
    const { tripId, p } = await acceptedTrip();
    const res = await t
      .http()
      .post(`/trips/${tripId}/share`)
      .set(bearer(p.accessToken))
      .expect(201);
    expect(res.body.url).toMatch(/^https:\/\/web\.musride\.test\/share\/#[A-Za-z0-9_-]{32}$/);

    const seen = await view(tokenOf(res.body.url)).expect(200);
    expect(seen.body.status).toBe('accepted');
    expect(seen.body.driver.plate).toMatch(/^RD-/);
    expect(seen.body.driver.location.isLive).toBe(true);
    const text = JSON.stringify(seen.body);
    expect(text).not.toMatch(/\+251|phone|passenger/i);

    // Only the secret's hash is stored.
    const rows = await t.db
      .selectFrom('trip_shares')
      .select('token_hash')
      .where('trip_id', '=', tripId)
      .execute();
    expect(rows[0]!.token_hash).not.toContain(tokenOf(res.body.url));
  });

  it('the link shows nothing once the trip has ended', async () => {
    const { tripId, p } = await acceptedTrip();
    const res = await t
      .http()
      .post(`/trips/${tripId}/share`)
      .set(bearer(p.accessToken))
      .expect(201);
    await t.http().post(`/trips/${tripId}/cancel`).set(bearer(p.accessToken)).send({}).expect(200);
    const seen = await view(tokenOf(res.body.url)).expect(200);
    expect(seen.body).toEqual({ status: 'ended' });
    await t.http().post(`/trips/${tripId}/share`).set(bearer(p.accessToken)).expect(409);
  });

  it('unknown links look the same as ended ones; malformed ones are refused', async () => {
    expect((await view('A'.repeat(32)).expect(200)).body).toEqual({ status: 'ended' });
    await view('short').expect(400);
  });

  it("only the trip's own passenger can share it, at most 5 times", async () => {
    const { tripId, p, d } = await acceptedTrip();
    const other = await loginAs(t, 'passenger');
    await t.http().post(`/trips/${tripId}/share`).set(bearer(other.accessToken)).expect(404);
    await t.http().post(`/trips/${tripId}/share`).set(bearer(d.token)).expect(403);
    for (let i = 0; i < 5; i++) {
      await t.http().post(`/trips/${tripId}/share`).set(bearer(p.accessToken)).expect(201);
    }
    await t.http().post(`/trips/${tripId}/share`).set(bearer(p.accessToken)).expect(429);
  });
});

describe('Share my trip without a website address', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startTestApp();
  });
  afterAll(() => t.close());

  it('is switched off', async () => {
    const p = await loginAs(t, 'passenger');
    await t
      .http()
      .post('/trips/00000000-0000-4000-8000-000000000000/share')
      .set({ Authorization: `Bearer ${p.accessToken}` })
      .expect(503);
  });
});
