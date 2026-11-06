import { seedDevelopment, syncMarket } from '../src/database/seed-dev';
import { loginAs, startTestApp, type TestApp } from './helpers/app';
import { readyDriver } from './helpers/drivers';

// Westlands → Kilimani, Nairobi (≈ 4 km).
const WESTLANDS = { lat: -1.2676, lng: 36.8108 };
const KILIMANI = { lat: -1.2921, lng: 36.7836 };
const JIJIGA = { lat: 9.3505, lng: 42.7979 };
const JIJIGA_B = { lat: 9.3655, lng: 42.8079 };

describe('Market (e2e)', () => {
  describe('Jijiga (ET, the default and the only option in production)', () => {
    let t: TestApp;
    beforeAll(async () => {
      t = await startTestApp();
      await seedDevelopment(t.db);
      await syncMarket(t.db, 'ET');
    });
    afterAll(() => t.close());

    it('tells clients the city, currency, payments and emergency numbers', async () => {
      const m = await t.http().get('/market').expect(200);
      expect(m.body).toMatchObject({ code: 'ET', city: 'Jijiga', currency: 'ETB' });
      expect(m.body.paymentMethods).toEqual(['cash', 'ebirr']);
      expect(m.body.emergency.map((e: { number: string }) => e.number)).toEqual([
        '991',
        '907',
        '939',
        '945',
      ]);
    });

    it('refuses Nairobi trips and M-Pesa', async () => {
      const p = await loginAs(t, 'passenger');
      const q = (body: object) =>
        t.http().post('/quotes').set('Authorization', `Bearer ${p.accessToken}`).send(body);
      expect(
        (await q({ pickup: WESTLANDS, destination: KILIMANI }).expect(422)).body.error.code,
      ).toBe('PICKUP_OUTSIDE_SERVICE_AREA');
      const r = await q({ pickup: JIJIGA, destination: JIJIGA_B, paymentMethod: 'mpesa' }).expect(
        400,
      );
      expect(r.body.error.code).toBe('PAYMENT_METHOD_NOT_AVAILABLE');
    });
  });

  describe('Nairobi (KE, staging tests)', () => {
    let t: TestApp;
    beforeAll(async () => {
      t = await startTestApp({ MARKET: 'KE' });
      await seedDevelopment(t.db);
      await syncMarket(t.db, 'KE');
    });
    afterAll(async () => {
      await syncMarket(t.db, 'ET');
      await t.close();
    });

    it('is Nairobi: KES, cash and M-Pesa, 999 and 112', async () => {
      const m = await t.http().get('/market').expect(200);
      expect(m.body).toMatchObject({ code: 'KE', city: 'Nairobi', currency: 'KES' });
      expect(m.body.paymentMethods).toEqual(['cash', 'mpesa']);
      expect(m.body.emergency.map((e: { number: string }) => e.number)).toEqual(['999', '112']);
    });

    it('accepts a Kenyan number written the local way', async () => {
      await t
        .http()
        .post('/auth/otp/request')
        .set('X-Forwarded-For', '10.254.1.1')
        .send({ phone: '0712 345 678' })
        .expect(200);
    });

    it('prices a Nairobi trip with the KES test prices; Jijiga is off; eBirr is refused', async () => {
      const p = await loginAs(t, 'passenger');
      const q = (body: object) =>
        t.http().post('/quotes').set('Authorization', `Bearer ${p.accessToken}`).send(body);
      const res = await q({
        pickup: WESTLANDS,
        destination: KILIMANI,
        paymentMethod: 'mpesa',
      }).expect(200);
      const car = res.body.quotes.find((x: { category: string }) => x.category === 'car');
      // 150 KES + 40 KES/km over ~4–6 km, rounded to 10 KES: a few hundred shillings.
      expect(Number(car.fare)).toBeGreaterThanOrEqual(25000);
      expect(Number(car.fare)).toBeLessThan(100000);
      await q({ pickup: JIJIGA, destination: JIJIGA_B }).expect(422);
      await q({ pickup: WESTLANDS, destination: KILIMANI, paymentMethod: 'ebirr' }).expect(400);
    });

    it('an M-Pesa ride payment needs the confirmation code', async () => {
      const d = await readyDriver(t, { lat: WESTLANDS.lat + 0.001, lng: WESTLANDS.lng });
      const p = await loginAs(t, 'passenger');
      const auth = (tok: string) => ({ Authorization: `Bearer ${tok}` });
      const q = await t
        .http()
        .post('/quotes')
        .set(auth(p.accessToken))
        .send({
          pickup: WESTLANDS,
          destination: KILIMANI,
          categories: ['car'],
          paymentMethod: 'mpesa',
        })
        .expect(200);
      const trip = await t
        .http()
        .post('/trips')
        .set(auth(p.accessToken))
        .send({ quoteToken: q.body.quotes[0].quoteToken })
        .expect(201);
      const id = trip.body.id as string;
      await t.http().post(`/trips/${id}/accept`).set(auth(d.token)).expect(200);
      await t.http().post(`/trips/${id}/arrived`).set(auth(d.token)).expect(200);
      const pin = (
        await t.db
          .selectFrom('trips')
          .select('start_pin')
          .where('id', '=', id)
          .executeTakeFirstOrThrow()
      ).start_pin;
      await t.http().post(`/trips/${id}/start`).set(auth(d.token)).send({ pin }).expect(200);
      await t.http().post(`/trips/${id}/complete`).set(auth(d.token)).expect(200);
      const pay = (body: object) =>
        t.http().post(`/trips/${id}/payment/received`).set(auth(d.token)).send(body);
      expect((await pay({ method: 'mpesa' }).expect(400)).body.error.code).toBe(
        'REFERENCE_REQUIRED',
      );
      await pay({ method: 'ebirr', reference: 'ABC12345' }).expect(400);
      const ok = await pay({ method: 'mpesa', reference: 'SGH3K2L9QX' }).expect(200);
      expect(JSON.stringify(ok.body)).toContain('SGH3K2L9QX');
    });

    it('switching back to Jijiga turns Nairobi off and restores ETB prices', async () => {
      await syncMarket(t.db, 'ET');
      const zone = await t.db
        .selectFrom('service_zones')
        .select('active')
        .where('name', '=', 'Nairobi (TEST only)')
        .executeTakeFirstOrThrow();
      expect(zone.active).toBe(false);
      const v = await t.db
        .selectFrom('fare_settings as s')
        .innerJoin('fare_versions as v', 'v.id', 's.current_version_id')
        .select('v.note')
        .where('s.category', '=', 'car')
        .executeTakeFirstOrThrow();
      expect(v.note).toMatch(/^DEV seed/);
      await syncMarket(t.db, 'KE');
    });
  });
});
