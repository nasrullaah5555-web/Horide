import { seedDevelopment } from '../src/database/seed-dev';
import { loginAs, startTestApp } from './helpers/app';

describe('Quotes when the routing service is down (e2e)', () => {
  it('answers 503 with a plain message instead of a crash or a guessed price', async () => {
    // Port 9 (discard) on localhost: nothing listens, so every routing request fails.
    const t = await startTestApp({
      ROUTING_PROVIDER: 'osrm',
      ROUTING_OSRM_URL: 'http://127.0.0.1:9',
    });
    try {
      await seedDevelopment(t.db);
      const p = await loginAs(t, 'passenger');
      const res = await t
        .http()
        .post('/quotes')
        .set('Authorization', `Bearer ${p.accessToken}`)
        .send({
          pickup: { lat: 9.3505, lng: 42.7979 },
          destination: { lat: 9.3655, lng: 42.8079 },
          categories: ['car'],
          paymentMethod: 'cash',
        })
        .expect(503);
      expect(res.body.error.code).toBe('ROUTING_UNAVAILABLE');
    } finally {
      await t.close();
    }
  });
});
