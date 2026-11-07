import { sql } from 'kysely';
import sharp from 'sharp';
import { seedDevelopment } from '../src/database/seed-dev';
import { loginAs, startTestApp, type TestApp } from './helpers/app';
import { readyDriver } from './helpers/drivers';
import { createAdmin } from './helpers/fixtures';

const PICKUP = { lat: 9.3505, lng: 42.7979 };
const DEST = { lat: 9.3655, lng: 42.8079 };

/** A large photo carrying camera metadata, like one straight from a phone. */
function phonePhoto(width: number, height: number) {
  return sharp({ create: { width, height, channels: 3, background: '#3a6ea5' } })
    .withExif({ IFD0: { Make: 'TestPhone', Model: 'Camera 1' } })
    .jpeg()
    .toBuffer();
}

describe('Driver and car photos for the passenger (e2e)', () => {
  let t: TestApp;
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    t = await startTestApp();
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

  function upload(
    token: string,
    type: string,
    file: Buffer,
    vehicleId?: string,
    name = 'photo.jpg',
  ) {
    const r = t.http().post('/driver/documents').set(bearer(token)).field('type', type);
    if (vehicleId) r.field('vehicleId', vehicleId);
    return r.attach('file', file, name);
  }

  async function approve(documentId: string) {
    await t.db
      .updateTable('driver_documents')
      .set({
        status: 'approved',
        reviewed_at: new Date(),
        reviewed_by: (await createAdmin(t.db)).id,
      })
      .where('id', '=', documentId)
      .execute();
  }

  async function booked() {
    const d = await readyDriver(t, { lat: PICKUP.lat + 0.001, lng: PICKUP.lng });
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
    return { tripId: trip.body.id as string, p, d };
  }

  it('after acceptance the passenger gets small copies of the approved photos, without camera data', async () => {
    const { tripId, p, d } = await booked();
    const face = await upload(d.token, 'profile_photo', await phonePhoto(1600, 2000)).expect(201);
    const car = await upload(
      d.token,
      'vehicle_photo',
      await phonePhoto(2000, 1500),
      d.vehicleId,
    ).expect(201);
    await approve(face.body.id);
    await approve(car.body.id);

    // Not yet: no driver on the trip.
    await t.http().get(`/trips/${tripId}/photos`).set(bearer(p.accessToken)).expect(404);

    await t.http().post(`/trips/${tripId}/accept`).set(bearer(d.token)).expect(200);
    const res = await t
      .http()
      .get(`/trips/${tripId}/photos`)
      .set(bearer(p.accessToken))
      .expect(200);

    const faceOut = Buffer.from(res.body.driver.data, 'base64');
    const carOut = Buffer.from(res.body.vehicle.data, 'base64');
    const faceMeta = await sharp(faceOut).metadata();
    const carMeta = await sharp(carOut).metadata();
    expect([faceMeta.format, faceMeta.width, faceMeta.height]).toEqual(['jpeg', 240, 240]);
    expect([carMeta.format, carMeta.width, carMeta.height]).toEqual(['jpeg', 480, 320]);
    expect(faceMeta.exif).toBeUndefined();
    expect(carMeta.exif).toBeUndefined();
    expect(faceOut.length).toBeLessThan(40_000);
  });

  it('photos staff have not approved are not shown', async () => {
    const { tripId, p, d } = await booked();
    await upload(d.token, 'profile_photo', await phonePhoto(800, 800)).expect(201);
    await t.http().post(`/trips/${tripId}/accept`).set(bearer(d.token)).expect(200);
    const res = await t
      .http()
      .get(`/trips/${tripId}/photos`)
      .set(bearer(p.accessToken))
      .expect(200);
    expect(res.body).toEqual({ driver: null, vehicle: null });
  });

  it('only the passenger of the trip can see them', async () => {
    const { tripId, d } = await booked();
    await t.http().post(`/trips/${tripId}/accept`).set(bearer(d.token)).expect(200);
    const stranger = await loginAs(t, 'passenger');
    await t.http().get(`/trips/${tripId}/photos`).set(bearer(stranger.accessToken)).expect(404);
    await t.http().get(`/trips/${tripId}/photos`).set(bearer(d.token)).expect(403);
    await t.http().get(`/trips/${tripId}/photos`).expect(401);
  });

  it('a car photo must be a photo of a registered vehicle, not a PDF', async () => {
    const d = await readyDriver(t, { lat: PICKUP.lat, lng: PICKUP.lng, online: false });
    const pdf = Buffer.from('%PDF-1.4\n%test\n');
    await upload(d.token, 'vehicle_photo', pdf, d.vehicleId, 'car.pdf').expect(415);
    await upload(d.token, 'vehicle_photo', await phonePhoto(400, 300)).expect(400);
  });
});
