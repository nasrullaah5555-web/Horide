import { loginAs, startTestApp, type TestApp } from './helpers/app';

describe('Place search (e2e, development provider)', () => {
  let t: TestApp;
  let token: string;
  beforeAll(async () => {
    t = await startTestApp();
    token = (await loginAs(t, 'passenger')).accessToken;
  });
  afterAll(() => t.close());

  const get = (path: string, auth = true) => {
    const r = t.http().get(path);
    return auth ? r.set('Authorization', `Bearer ${token}`) : r;
  };

  it('suggests places while typing, then gives the chosen one', async () => {
    const res = await get('/places/search?q=donholm&lat=-1.27&lng=36.85&session=abcdefgh12').expect(
      200,
    );
    expect(res.body.places[0]).toMatchObject({ name: 'Donholm', detail: 'Nairobi' });
    const d = await get(`/places/details?id=${encodeURIComponent(res.body.places[0].id)}`).expect(
      200,
    );
    expect(d.body.point).toEqual({ lat: -1.2967, lng: 36.8908 });
  });

  it('validates input and needs a login', async () => {
    await get('/places/search?q=a').expect(400);
    await get('/places/search?q=ok&lat=200&lng=0').expect(400);
    await get('/places/reverse?lat=1').expect(400);
    await get('/places/search?q=donholm', false).expect(401);
  });

  it('an unknown place is reported as unavailable, not as a crash', async () => {
    const r = await get('/places/details?id=pt:1.000000,2.000000').expect(503);
    expect(r.body.error.code).toBe('PLACES_UNAVAILABLE');
  });
});
