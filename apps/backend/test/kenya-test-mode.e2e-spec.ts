import { seedDevelopment, syncKenyaTestZone } from '../src/database/seed-dev';
import { loginAs, startTestApp, type TestApp } from './helpers/app';

// Westlands → Kilimani, Nairobi (≈ 4 km).
const WESTLANDS = { lat: -1.2676, lng: 36.8108 };
const KILIMANI = { lat: -1.2921, lng: 36.7836 };

describe('Kenya test mode (e2e)', () => {
  describe('off (the default, and the only option in production)', () => {
    let t: TestApp;
    beforeAll(async () => {
      t = await startTestApp();
      await seedDevelopment(t.db);
      await syncKenyaTestZone(t.db, false);
    });
    afterAll(() => t.close());

    it('refuses Kenyan numbers and Nairobi trips', async () => {
      await t
        .http()
        .post('/auth/otp/request')
        .set('X-Forwarded-For', '10.254.0.2')
        .send({ phone: '+254712345678' })
        .expect(400);
      const p = await loginAs(t, 'passenger');
      const res = await t
        .http()
        .post('/quotes')
        .set('Authorization', `Bearer ${p.accessToken}`)
        .send({ pickup: WESTLANDS, destination: KILIMANI })
        .expect(422);
      expect(res.body.error.code).toBe('PICKUP_OUTSIDE_SERVICE_AREA');
    });
  });

  describe('on', () => {
    let t: TestApp;
    beforeAll(async () => {
      t = await startTestApp({ KENYA_TEST_MODE: 'true' });
      await seedDevelopment(t.db);
      await syncKenyaTestZone(t.db, true);
    });
    afterAll(async () => {
      await syncKenyaTestZone(t.db, false);
      await t.close();
    });

    it('sends a code to a Kenyan number written with +254', async () => {
      await t
        .http()
        .post('/auth/otp/request')
        .set('X-Forwarded-For', '10.254.0.1')
        .send({ phone: '+254 712 345 678' })
        .expect(200);
    });

    it('prices a trip inside Nairobi', async () => {
      const p = await loginAs(t, 'passenger');
      const res = await t
        .http()
        .post('/quotes')
        .set('Authorization', `Bearer ${p.accessToken}`)
        .send({ pickup: WESTLANDS, destination: KILIMANI })
        .expect(200);
      expect(res.body.quotes).toHaveLength(2);
    });

    it('turning the mode off makes the Nairobi area inactive again', async () => {
      await syncKenyaTestZone(t.db, false);
      const zone = await t.db
        .selectFrom('service_zones')
        .select('active')
        .where('name', '=', 'Nairobi (TEST only)')
        .executeTakeFirstOrThrow();
      expect(zone.active).toBe(false);
      await syncKenyaTestZone(t.db, true);
    });
  });
});
