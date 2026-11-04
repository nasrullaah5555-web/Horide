import { sql } from 'kysely';
import { seedDevelopment } from '../src/database/seed-dev';
import { MatchingService } from '../src/modules/trips/matching.service';
import { loginAs, startTestApp, type TestApp } from './helpers/app';
import { readyDriver } from './helpers/drivers';

// Jijiga, inside the development service zone.
const PICKUP = { lat: 9.3505, lng: 42.7979 };
const DEST = { lat: 9.3655, lng: 42.8079 };
/** Offsets in degrees: 0.005° ≈ 550 m, 0.03° ≈ 3.3 km. */
const near = (dLat: number) => ({ lat: PICKUP.lat + dLat, lng: PICKUP.lng });

describe('Ride flow: request, matching, acceptance, lifecycle (e2e)', () => {
  let t: TestApp;
  let matching: MatchingService;

  beforeAll(async () => {
    t = await startTestApp();
    await seedDevelopment(t.db);
    matching = t.app.get(MatchingService);
  });

  afterAll(async () => {
    await t.close();
  });

  beforeEach(async () => {
    // Each test starts with no drivers online and no open trips, so tests can't influence each other.
    await t.db.updateTable('driver_locations').set({ is_online: false }).execute();
    await sql`UPDATE trips SET status = 'cancelled', cancelled_at = now(), cancelled_by = 'admin'
              WHERE status IN ('requested','searching','accepted','driver_arriving','arrived','in_progress')`.execute(
      t.db,
    );
  });

  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function passengerWithQuote(
    category: 'car' | 'bajaj' = 'car',
    paymentMethod: 'cash' | 'ebirr' = 'cash',
  ) {
    const p = await loginAs(t, 'passenger');
    const q = await t
      .http()
      .post('/quotes')
      .set(bearer(p.accessToken))
      .send({
        pickup: PICKUP,
        destination: DEST,
        categories: [category],
        paymentMethod,
        pickupText: 'Taiwan Market',
      })
      .expect(200);
    return {
      p,
      quoteToken: q.body.quotes[0].quoteToken as string,
      fare: q.body.quotes[0].fare as string,
    };
  }

  async function book(category: 'car' | 'bajaj' = 'car') {
    const { p, quoteToken, fare } = await passengerWithQuote(category);
    const res = await t
      .http()
      .post('/trips')
      .set(bearer(p.accessToken))
      .send({ quoteToken })
      .expect(201);
    return { p, quoteToken, fare, tripId: res.body.id as string };
  }

  const offersFor = async (token: string) =>
    (await t.http().get('/driver/offers').set(bearer(token)).expect(200)).body.offers as {
      trip_id: string;
    }[];

  describe('driver availability and location', () => {
    it('an ineligible driver cannot go online and is told why', async () => {
      const d = await loginAs(t, 'driver');
      const res = await t
        .http()
        .post('/driver/availability')
        .set(bearer(d.accessToken))
        .send({
          online: true,
          position: { ...PICKUP, recordedAt: new Date().toISOString(), accuracyM: 10 },
        })
        .expect(403);
      expect(res.body.error.details.reasons).toEqual(
        expect.arrayContaining([
          'DRIVER_NOT_APPROVED',
          'NO_APPROVED_VEHICLE',
          'SUBSCRIPTION_INACTIVE',
        ]),
      );
    });

    it('an eligible driver goes online; inaccurate or future positions are refused', async () => {
      const d = await readyDriver(t, { ...PICKUP, online: false });
      const go = (position: object) =>
        t.http().post('/driver/availability').set(bearer(d.token)).send({ online: true, position });
      expect(
        (await go({ ...PICKUP, recordedAt: new Date().toISOString(), accuracyM: 500 }).expect(422))
          .body.error.code,
      ).toBe('LOCATION_INACCURATE');
      const future = new Date(Date.now() + 10 * 60_000).toISOString();
      expect((await go({ ...PICKUP, recordedAt: future }).expect(422)).body.error.code).toBe(
        'LOCATION_FUTURE',
      );
      await go({ ...PICKUP, recordedAt: new Date().toISOString(), accuracyM: 8 }).expect(200);
    });

    /** Pretend the driver's last fix was a minute ago, so new points are newer and realistic. */
    const backdate = (driverId: string) =>
      sql`UPDATE driver_locations SET recorded_at = now() - interval '1 minute' WHERE driver_id = ${driverId}`.execute(
        t.db,
      );

    it('drops a teleport jump but keeps plausible movement', async () => {
      const d = await readyDriver(t, PICKUP);
      await backdate(d.id);
      const now = Date.now();
      const res = await t
        .http()
        .post('/driver/location')
        .set(bearer(d.token))
        .send({
          points: [
            { ...near(0.001), recordedAt: new Date(now - 10_000).toISOString(), accuracyM: 10 }, // ~110 m in 10 s: fine
            {
              lat: 9.03,
              lng: 38.74,
              recordedAt: new Date(now - 5_000).toISOString(),
              accuracyM: 10,
            }, // Addis in 5 s: no
            { ...near(0.002), recordedAt: new Date(now).toISOString(), accuracyM: 10 },
          ],
        })
        .expect(200);
      expect(res.body).toEqual({ accepted: 2, rejected: { implausible_jump: 1 } });
    });

    it('an older point never overwrites a newer position', async () => {
      const d = await readyDriver(t, PICKUP);
      await backdate(d.id);
      const send = (lat: number, ago: number) =>
        t
          .http()
          .post('/driver/location')
          .set(bearer(d.token))
          .send({
            points: [
              { lat, lng: PICKUP.lng, recordedAt: new Date(Date.now() - ago).toISOString() },
            ],
          });
      await send(PICKUP.lat + 0.002, 0).expect(200);
      await send(PICKUP.lat + 0.001, 20_000).expect(200);
      const row = await sql<{
        lat: number;
      }>`SELECT ST_Y(position::geometry) AS lat FROM driver_locations WHERE driver_id = ${d.id}`.execute(
        t.db,
      );
      expect(row.rows[0]?.lat).toBeCloseTo(PICKUP.lat + 0.002, 6);
    });
  });

  describe('booking', () => {
    it('the same quote books only one trip (safe retry)', async () => {
      const { p, quoteToken } = await passengerWithQuote();
      const first = await t
        .http()
        .post('/trips')
        .set(bearer(p.accessToken))
        .send({ quoteToken })
        .expect(201);
      const retry = await t
        .http()
        .post('/trips')
        .set(bearer(p.accessToken))
        .send({ quoteToken })
        .expect(200);
      expect(retry.body.id).toBe(first.body.id);
    });

    it('a passenger cannot have two open trips', async () => {
      const { p, quoteToken } = await passengerWithQuote();
      await t.http().post('/trips').set(bearer(p.accessToken)).send({ quoteToken }).expect(201);
      const q2 = await t
        .http()
        .post('/quotes')
        .set(bearer(p.accessToken))
        .send({ pickup: PICKUP, destination: DEST, categories: ['bajaj'] })
        .expect(200);
      const res = await t
        .http()
        .post('/trips')
        .set(bearer(p.accessToken))
        .send({ quoteToken: q2.body.quotes[0].quoteToken })
        .expect(409);
      expect(res.body.error.code).toBe('TRIP_ALREADY_OPEN');
    });

    it("another passenger's quote cannot be used", async () => {
      const { quoteToken } = await passengerWithQuote();
      const thief = await loginAs(t, 'passenger');
      const res = await t
        .http()
        .post('/trips')
        .set(bearer(thief.accessToken))
        .send({ quoteToken })
        .expect(400);
      expect(res.body.error.code).toBe('QUOTE_INVALID');
    });
  });

  describe('matching', () => {
    it('offers the ride only to nearby, eligible drivers of the right category, nearest first', async () => {
      const nearest = await readyDriver(t, near(0.002));
      const second = await readyDriver(t, near(0.004));
      const bajaj = await readyDriver(t, { ...near(0.001), category: 'bajaj' });
      const far = await readyDriver(t, near(0.1)); // ~11 km: outside every wave
      const stale = await readyDriver(t, near(0.001));
      await sql`UPDATE driver_locations SET recorded_at = now() - interval '2 minutes' WHERE driver_id = ${stale.id}`.execute(
        t.db,
      );
      const expired = await readyDriver(t, near(0.001));
      await sql`UPDATE subscriptions SET ends_at = now() - interval '1 minute', starts_at = now() - interval '31 days'
                WHERE id = ${expired.subscriptionId}`.execute(t.db);
      const suspended = await readyDriver(t, near(0.001));
      await t.db
        .updateTable('users')
        .set({ status: 'suspended', suspended_reason: 'test' })
        .where('id', '=', suspended.id)
        .execute();

      const { tripId } = await book('car');

      expect((await offersFor(nearest.token)).map((o) => o.trip_id)).toEqual([tripId]);
      expect((await offersFor(second.token)).map((o) => o.trip_id)).toEqual([tripId]);
      for (const d of [bajaj, far, stale, expired, suspended])
        expect(await offersFor(d.token)).toHaveLength(0);
    });

    it('when a driver rejects, the next driver gets the offer', async () => {
      const ids = [];
      for (let i = 1; i <= 4; i++) ids.push(await readyDriver(t, near(0.001 * i)));
      const { tripId } = await book();
      // First wave reaches the 3 nearest.
      expect(await offersFor(ids[3]!.token)).toHaveLength(0);
      for (const d of ids.slice(0, 3))
        await t.http().post(`/trips/${tripId}/reject`).set(bearer(d.token)).expect(204);
      expect((await offersFor(ids[3]!.token)).map((o) => o.trip_id)).toEqual([tripId]);
    });

    it('expired offers move to the next wave; a trip with no acceptance expires', async () => {
      const d = await readyDriver(t, near(0.03)); // ~3.3 km: only reached by wave 2
      const { tripId, p } = await book();
      expect(await offersFor(d.token)).toHaveLength(0);
      await matching.sweep(); // wave 2
      expect((await offersFor(d.token)).map((o) => o.trip_id)).toEqual([tripId]);

      await sql`UPDATE trip_offers SET expires_at = now() - interval '1 second' WHERE trip_id = ${tripId}`.execute(
        t.db,
      );
      await sql`UPDATE trips SET requested_at = now() - interval '10 minutes' WHERE id = ${tripId}`.execute(
        t.db,
      );
      await matching.sweep();
      const trip = await t.http().get(`/trips/${tripId}`).set(bearer(p.accessToken)).expect(200);
      expect(trip.body.status).toBe('expired');
    });
  });

  describe('acceptance', () => {
    it('20 drivers accepting at the same moment: exactly one wins', async () => {
      const drivers = await Promise.all(
        Array.from({ length: 20 }, (_, i) => readyDriver(t, near(0.0005 * (i + 1)))),
      );
      const { tripId } = await book();
      // Give every driver an offer so all 20 can try.
      await t.db
        .insertInto('trip_offers')
        .values(
          drivers.map((d) => ({
            trip_id: tripId,
            driver_id: d.id,
            wave: 1,
            distance_m: 100,
            expires_at: new Date(Date.now() + 20_000),
          })),
        )
        .onConflict((oc) => oc.columns(['trip_id', 'driver_id']).doNothing())
        .execute();

      const results = await Promise.all(
        drivers.map((d) => t.http().post(`/trips/${tripId}/accept`).set(bearer(d.token))),
      );
      const winners = results.filter((r) => r.status === 200);
      expect(winners).toHaveLength(1);
      for (const r of results.filter((r) => r.status !== 200)) {
        expect(r.status).toBe(409);
        expect(['TRIP_TAKEN', 'OFFER_CLOSED']).toContain(r.body.error.code);
      }
      const trip = await t.db
        .selectFrom('trips')
        .select(['driver_id', 'locked_fare', 'quoted_fare', 'status'])
        .where('id', '=', tripId)
        .executeTakeFirstOrThrow();
      expect(trip.status).toBe('accepted');
      expect(trip.locked_fare).toBe(trip.quoted_fare);
      const events = await t.db
        .selectFrom('trip_events')
        .select('to_status')
        .where('trip_id', '=', tripId)
        .where('to_status', '=', 'accepted')
        .execute();
      expect(events).toHaveLength(1);
    }, 60_000);

    it('a driver whose subscription expired after the offer cannot accept', async () => {
      const d = await readyDriver(t, near(0.001));
      const { tripId } = await book();
      await sql`UPDATE subscriptions SET ends_at = now() - interval '1 second', starts_at = now() - interval '31 days'
                WHERE id = ${d.subscriptionId}`.execute(t.db);
      const res = await t.http().post(`/trips/${tripId}/accept`).set(bearer(d.token)).expect(403);
      expect(res.body.error.details.reasons).toContain('SUBSCRIPTION_INACTIVE');
    });

    it('a driver without an offer for the trip cannot accept it', async () => {
      const outsider = await readyDriver(t, near(0.1));
      const { tripId } = await book();
      await t.http().post(`/trips/${tripId}/accept`).set(bearer(outsider.token)).expect(404);
    });
  });

  describe('lifecycle', () => {
    async function acceptedTrip() {
      const d = await readyDriver(t, near(0.001));
      const booking = await book();
      await t.http().post(`/trips/${booking.tripId}/accept`).set(bearer(d.token)).expect(200);
      return { ...booking, d };
    }

    it('completes a full ride and creates a payment record for the locked fare', async () => {
      const { tripId, p, d, fare } = await acceptedTrip();

      const seen = await t.http().get(`/trips/${tripId}`).set(bearer(p.accessToken)).expect(200);
      expect(seen.body.driver.vehicle.plate).toMatch(/^RD-/);
      expect(seen.body.driver.phone).toMatch(/^\+251/);
      expect(seen.body.driverLocation.isLive).toBe(true);

      for (const step of ['arriving', 'arrived', 'start', 'complete']) {
        await t.http().post(`/trips/${tripId}/${step}`).set(bearer(d.token)).expect(200);
      }
      const done = await t.http().get(`/trips/${tripId}`).set(bearer(p.accessToken)).expect(200);
      expect(done.body.status).toBe('completed');
      expect(done.body.fare.final).toBe(fare);
      expect(done.body.driver.phone).toBeUndefined(); // phone hidden once the trip is over

      const payment = await t.db
        .selectFrom('payments')
        .select(['amount', 'method', 'status'])
        .where('trip_id', '=', tripId)
        .executeTakeFirstOrThrow();
      expect(payment).toEqual({ amount: fare, method: 'cash', status: 'pending' });

      const statuses = (
        await t.db
          .selectFrom('trip_events')
          .select('to_status')
          .where('trip_id', '=', tripId)
          .orderBy('id')
          .execute()
      ).map((e) => e.to_status);
      expect(statuses).toEqual([
        'searching',
        'accepted',
        'driver_arriving',
        'arrived',
        'in_progress',
        'completed',
      ]);
    });

    it('refuses steps out of order and steps by the wrong person', async () => {
      const { tripId, p, d } = await acceptedTrip();
      const other = await readyDriver(t, near(0.2));
      expect(
        (await t.http().post(`/trips/${tripId}/start`).set(bearer(d.token)).expect(409)).body.error
          .code,
      ).toBe('INVALID_TRIP_STATE');
      await t.http().post(`/trips/${tripId}/arrived`).set(bearer(other.token)).expect(404);
      await t.http().post(`/trips/${tripId}/complete`).set(bearer(p.accessToken)).expect(403);
      await t.http().post(`/trips/${tripId}/arrived`).set(bearer(d.token)).expect(200);
      await t.http().post(`/trips/${tripId}/start`).set(bearer(d.token)).expect(200);
      // Nobody but an admin may cancel a trip that is under way.
      await t
        .http()
        .post(`/trips/${tripId}/cancel`)
        .set(bearer(p.accessToken))
        .send({})
        .expect(409);
      await t.http().post(`/trips/${tripId}/cancel`).set(bearer(d.token)).send({}).expect(409);
    });

    it('an expiring subscription does not interrupt a trip already accepted (BR-05)', async () => {
      const { tripId, d } = await acceptedTrip();
      await sql`UPDATE subscriptions SET ends_at = now() - interval '1 second', starts_at = now() - interval '31 days'
                WHERE id = ${d.subscriptionId}`.execute(t.db);
      for (const step of ['arrived', 'start', 'complete']) {
        await t.http().post(`/trips/${tripId}/${step}`).set(bearer(d.token)).expect(200);
      }
    });

    it('a passenger can cancel while searching; offers are withdrawn', async () => {
      const d = await readyDriver(t, near(0.001));
      const { tripId, p } = await book();
      expect(await offersFor(d.token)).toHaveLength(1);
      const res = await t
        .http()
        .post(`/trips/${tripId}/cancel`)
        .set(bearer(p.accessToken))
        .send({ reason: 'Changed my plans' })
        .expect(200);
      expect(res.body).toMatchObject({ status: 'cancelled', cancelledBy: 'passenger' });
      expect(await offersFor(d.token)).toHaveLength(0);
    });

    it('active trip resync and another user cannot read the trip (IDOR)', async () => {
      const { tripId, p, d } = await acceptedTrip();
      const mine = await t.http().get('/trips/active').set(bearer(p.accessToken)).expect(200);
      expect(mine.body.trip.id).toBe(tripId);
      const driverView = await t.http().get('/trips/active').set(bearer(d.token)).expect(200);
      expect(driverView.body.trip.passenger.phone).toMatch(/^\+251/);
      const stranger = await loginAs(t, 'passenger');
      await t.http().get(`/trips/${tripId}`).set(bearer(stranger.accessToken)).expect(404);
    });

    it('labels a driver location older than 30 seconds as not live', async () => {
      const { tripId, p, d } = await acceptedTrip();
      await sql`UPDATE driver_locations SET recorded_at = now() - interval '45 seconds' WHERE driver_id = ${d.id}`.execute(
        t.db,
      );
      const res = await t
        .http()
        .get(`/trips/${tripId}/driver-location`)
        .set(bearer(p.accessToken))
        .expect(200);
      expect(res.body.location.isLive).toBe(false);
      expect(res.body.location.ageSeconds).toBeGreaterThanOrEqual(45);
    });

    it('location points sent during a trip are kept as trip history', async () => {
      const { tripId, d } = await acceptedTrip();
      await t
        .http()
        .post('/driver/location')
        .set(bearer(d.token))
        .send({ points: [{ ...near(0.0015), recordedAt: new Date().toISOString(), accuracyM: 5 }] })
        .expect(200);
      const n = await t.db
        .selectFrom('trip_locations')
        .select('id')
        .where('trip_id', '=', tripId)
        .execute();
      expect(n).toHaveLength(1);
    });
  });
});
