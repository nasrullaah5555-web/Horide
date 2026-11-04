import { seedDevelopment } from '../src/database/seed-dev';
import { verifyQuote } from '../src/modules/pricing/quote-token';
import { adminLogin, type AdminSession } from './helpers/admin';
import { loginAs, startTestApp, type TestApp } from './helpers/app';

const CENTRE = { lat: 9.3505, lng: 42.7979 };
const NEARBY = { lat: 9.3655, lng: 42.8079 }; // ≈ 2 km away, inside the dev zone
const ADDIS = { lat: 9.03, lng: 38.74 };

describe('Zones, fares and quotes (e2e)', () => {
  let t: TestApp;
  let ops: AdminSession;
  let support: AdminSession;
  let passengerToken: string;
  let passengerId: string;

  beforeAll(async () => {
    t = await startTestApp();
    await seedDevelopment(t.db);
    ops = await adminLogin(t, ['operations']);
    support = await adminLogin(t, ['support']);
    const p = await loginAs(t, 'passenger');
    passengerToken = p.accessToken;
    passengerId = p.user.id;
  });

  afterAll(async () => {
    await t.close();
  });

  const quote = (body: object, token = passengerToken) =>
    t.http().post('/quotes').set('Authorization', `Bearer ${token}`).send(body);

  it('returns a price for car and bajaj with the distance clearly marked as an estimate', async () => {
    const res = await quote({ pickup: CENTRE, destination: NEARBY }).expect(200);
    expect(res.body.quotes).toHaveLength(2);
    const car = res.body.quotes.find((q: { category: string }) => q.category === 'car');
    const bajaj = res.body.quotes.find((q: { category: string }) => q.category === 'bajaj');
    expect(car.isEstimate).toBe(true);
    expect(Number(car.fare)).toBeGreaterThan(Number(bajaj.fare));
    expect(Number(car.fare) % 500).toBe(0); // rounded to 5 ETB
    // Recompute by hand: 40 ETB + km × 15, rounded up to 5 ETB.
    const expected = Math.ceil((4000 + Math.round((car.distanceMetres * 1500) / 1000)) / 500) * 500;
    expect(Number(car.fare)).toBe(Math.max(expected, 6000));
  });

  it('signs the quote for this passenger, fare version and route', async () => {
    const res = await quote({ pickup: CENTRE, destination: NEARBY, categories: ['car'] }).expect(
      200,
    );
    const payload = verifyQuote(res.body.quotes[0].quoteToken, process.env.QUOTE_SIGNING_SECRET!);
    expect(payload).toMatchObject({ pid: passengerId, cat: 'car', fare: res.body.quotes[0].fare });
  });

  it('refuses pickups and destinations outside the service area', async () => {
    const a = await quote({ pickup: ADDIS, destination: NEARBY }).expect(422);
    expect(a.body.error.code).toBe('PICKUP_OUTSIDE_SERVICE_AREA');
    const b = await quote({ pickup: CENTRE, destination: ADDIS }).expect(422);
    expect(b.body.error.code).toBe('DESTINATION_OUTSIDE_SERVICE_AREA');
  });

  it('refuses trips that are too short', async () => {
    const res = await quote({ pickup: CENTRE, destination: { lat: 9.3506, lng: 42.798 } }).expect(
      422,
    );
    expect(res.body.error.code).toBe('TRIP_TOO_SHORT');
  });

  it('ignores any price the client tries to send', async () => {
    const res = await quote({ pickup: CENTRE, destination: NEARBY, fare: '1' }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('drivers cannot request passenger quotes', async () => {
    const d = await loginAs(t, 'driver');
    await quote({ pickup: CENTRE, destination: NEARBY }, d.accessToken).expect(403);
  });

  describe('admin pricing', () => {
    const asAdmin = (s: AdminSession) => ({ Cookie: s.cookie, 'X-CSRF-Token': s.csrf });

    it('a new price creates a new version, applies to new quotes, and is audited', async () => {
      const before = await quote({
        pickup: CENTRE,
        destination: NEARBY,
        categories: ['bajaj'],
      }).expect(200);
      const created = await t
        .http()
        .post('/admin/pricing/bajaj')
        .set(asAdmin(ops))
        .send({
          baseFare: 25,
          perKm: 10,
          minimumFare: 35,
          roundingUnit: 5,
          note: 'Pilot price test',
        })
        .expect(201);
      expect(created.body.base_fare).toBe('2500');

      const after = await quote({
        pickup: CENTRE,
        destination: NEARBY,
        categories: ['bajaj'],
      }).expect(200);
      expect(after.body.quotes[0].fareVersionId).toBe(created.body.id);
      expect(after.body.quotes[0].fareVersionId).not.toBe(before.body.quotes[0].fareVersionId);
      expect(Number(after.body.quotes[0].fare)).toBeGreaterThan(Number(before.body.quotes[0].fare));

      const audit = await t.db
        .selectFrom('audit_logs')
        .select(['actor_id', 'before'])
        .where('action', '=', 'pricing.changed')
        .where('entity_id', '=', created.body.id)
        .executeTakeFirstOrThrow();
      expect(audit.actor_id).toBe(ops.id);
      expect(audit.before).not.toBeNull();
    });

    it('rejects more than 2 decimal places and a minimum below the base fare', async () => {
      await t
        .http()
        .post('/admin/pricing/car')
        .set(asAdmin(ops))
        .send({ baseFare: 40.001, perKm: 15, minimumFare: 60, roundingUnit: 5, note: 'bad' })
        .expect(400);
      const res = await t
        .http()
        .post('/admin/pricing/car')
        .set(asAdmin(ops))
        .send({ baseFare: 40, perKm: 15, minimumFare: 30, roundingUnit: 5, note: 'bad minimum' })
        .expect(400);
      expect(res.body.error.code).toBe('MINIMUM_BELOW_BASE');
    });

    it('support staff cannot change prices', async () => {
      await t
        .http()
        .post('/admin/pricing/car')
        .set(asAdmin(support))
        .send({ baseFare: 1, perKm: 1, minimumFare: 1, roundingUnit: 1, note: 'nope' })
        .expect(403);
    });

    it('saves a service zone and rejects a self-intersecting shape', async () => {
      await t
        .http()
        .post('/admin/zones')
        .set(asAdmin(ops))
        .send({
          name: 'Test zone',
          ring: [
            [42.7, 9.2],
            [42.71, 9.2],
            [42.71, 9.21],
            [42.7, 9.21],
          ],
        })
        .expect(201);
      const bowtie = await t
        .http()
        .post('/admin/zones')
        .set(asAdmin(ops))
        .send({
          name: 'Bad zone',
          ring: [
            [42.7, 9.2],
            [42.71, 9.21],
            [42.71, 9.2],
            [42.7, 9.21],
          ],
        })
        .expect(400);
      expect(bowtie.body.error.code).toBe('INVALID_ZONE');
    });
  });
});
