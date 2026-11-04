import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import { seedDevelopment } from '../src/database/seed-dev';
import { loginAs, startTestApp, type TestApp } from './helpers/app';
import { readyDriver } from './helpers/drivers';

const PICKUP = { lat: 9.3505, lng: 42.7979 };
const DEST = { lat: 9.3655, lng: 42.8079 };

describe('Realtime gateway (e2e)', () => {
  let t: TestApp;
  let url: string;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    t = await startTestApp();
    await seedDevelopment(t.db);
    await t.app.listen(0, '127.0.0.1');
    const { port } = t.app.getHttpServer().address() as AddressInfo;
    url = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    for (const s of sockets) s.disconnect();
    await t.close();
  });

  function connect(token: string): Socket {
    const s = io(url, {
      path: '/realtime',
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
    });
    sockets.push(s);
    return s;
  }

  function next<T = unknown>(s: Socket, event: string, timeoutMs = 5000): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timed out waiting for ${event}`)),
        timeoutMs,
      );
      s.once(event, (data: T) => {
        clearTimeout(timer);
        resolve(data);
      });
    });
  }

  it('refuses connections without a valid token', async () => {
    const s = connect('not-a-token');
    await next(s, 'disconnect');
    expect(s.connected).toBe(false);
  });

  it('delivers offers to the driver, the accepted trip to the passenger, and live location', async () => {
    const d = await readyDriver(t, { lat: PICKUP.lat + 0.001, lng: PICKUP.lng });
    const p = await loginAs(t, 'passenger');
    const driverSocket = connect(d.token);
    const passengerSocket = connect(p.accessToken);
    await Promise.all([next(driverSocket, 'ready'), next(passengerSocket, 'ready')]);

    const offer = next<{ tripId: string }>(driverSocket, 'offer.created');
    const q = await t
      .http()
      .post('/quotes')
      .set('Authorization', `Bearer ${p.accessToken}`)
      .send({ pickup: PICKUP, destination: DEST, categories: ['car'] })
      .expect(200);
    const booked = await t
      .http()
      .post('/trips')
      .set('Authorization', `Bearer ${p.accessToken}`)
      .send({ quoteToken: q.body.quotes[0].quoteToken })
      .expect(201);
    expect((await offer).tripId).toBe(booked.body.id);

    const accepted = next<{ id: string; status: string; driver: { vehicle: { plate: string } } }>(
      passengerSocket,
      'trip.updated',
    );
    await t
      .http()
      .post(`/trips/${booked.body.id}/accept`)
      .set('Authorization', `Bearer ${d.token}`)
      .expect(200);
    const view = await accepted;
    expect(view).toMatchObject({ id: booked.body.id, status: 'accepted' });
    expect(view.driver.vehicle.plate).toMatch(/^RD-/);

    const location = next<{ tripId: string; lat: number }>(passengerSocket, 'driver.location');
    await t
      .http()
      .post('/driver/location')
      .set('Authorization', `Bearer ${d.token}`)
      .send({
        points: [
          {
            lat: PICKUP.lat + 0.0012,
            lng: PICKUP.lng,
            recordedAt: new Date().toISOString(),
            accuracyM: 5,
          },
        ],
      })
      .expect(200);
    const loc = await location;
    expect(loc.tripId).toBe(booked.body.id);
    expect(loc.lat).toBeCloseTo(PICKUP.lat + 0.0012, 6);
  });

  it("another user's socket receives nothing about the trip", async () => {
    const d = await readyDriver(t, { lat: PICKUP.lat + 0.001, lng: PICKUP.lng + 0.001 });
    const p = await loginAs(t, 'passenger');
    const stranger = await loginAs(t, 'passenger');
    const strangerSocket = connect(stranger.accessToken);
    await next(strangerSocket, 'ready');
    const received: string[] = [];
    strangerSocket.onAny((event: string) => received.push(event));

    const q = await t
      .http()
      .post('/quotes')
      .set('Authorization', `Bearer ${p.accessToken}`)
      .send({ pickup: PICKUP, destination: DEST, categories: ['car'] })
      .expect(200);
    const booked = await t
      .http()
      .post('/trips')
      .set('Authorization', `Bearer ${p.accessToken}`)
      .send({ quoteToken: q.body.quotes[0].quoteToken })
      .expect(201);
    await t
      .http()
      .post(`/trips/${booked.body.id}/accept`)
      .set('Authorization', `Bearer ${d.token}`)
      .expect(200);
    await new Promise((r) => setTimeout(r, 300));
    expect(received).toEqual([]);
  });
});
