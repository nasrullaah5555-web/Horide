import { seedDevelopment } from '../src/database/seed-dev';
import { FixedWindowCounter } from '../src/common/rate-limit';
import { LogPushProvider, PUSH_PROVIDER } from '../src/modules/notifications/push.provider';
import { adminLogin, type AdminSession } from './helpers/admin';
import { loginAs, startTestApp, type TestApp, ridePin } from './helpers/app';
import { readyDriver } from './helpers/drivers';

const PICKUP = { lat: 9.3505, lng: 42.7979 };
const DEST = { lat: 9.3655, lng: 42.8079 };

/** Waits for fire-and-forget work (notifications are created after the request returns). */
async function eventually<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 3000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (ok(v) || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('Notifications, admin operations and rate limits (e2e)', () => {
  let t: TestApp;
  let ops: AdminSession;
  let support: AdminSession;
  let finance: AdminSession;

  beforeAll(async () => {
    t = await startTestApp();
    await seedDevelopment(t.db);
    ops = await adminLogin(t, ['operations']);
    support = await adminLogin(t, ['support']);
    finance = await adminLogin(t, ['finance']);
  });

  afterAll(async () => {
    await t.close();
  });

  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const admin = (s: AdminSession) => ({ Cookie: s.cookie, 'X-CSRF-Token': s.csrf });

  async function acceptedTrip() {
    await t.db.updateTable('driver_locations').set({ is_online: false }).execute();
    const d = await readyDriver(t, { lat: PICKUP.lat + 0.001, lng: PICKUP.lng });
    const p = await loginAs(t, 'passenger');
    await t
      .http()
      .post('/devices')
      .set(bearer(p.accessToken))
      .send({ token: `fcm-test-token-${p.user.id}`, platform: 'android' })
      .expect(204);
    const q = await t
      .http()
      .post('/quotes')
      .set(bearer(p.accessToken))
      .send({ pickup: PICKUP, destination: DEST, categories: ['car'] })
      .expect(200);
    const booked = await t
      .http()
      .post('/trips')
      .set(bearer(p.accessToken))
      .send({ quoteToken: q.body.quotes[0].quoteToken })
      .expect(201);
    await t.http().post(`/trips/${booked.body.id}/accept`).set(bearer(d.token)).expect(200);
    return { id: booked.body.id as string, p, d };
  }

  describe('notifications', () => {
    it('the passenger is notified (in-app and push) when a driver accepts and arrives', async () => {
      const { id, p, d } = await acceptedTrip();
      await t.http().post(`/trips/${id}/arrived`).set(bearer(d.token)).expect(200);
      const list = await eventually(
        async () =>
          (await t.http().get('/notifications').set(bearer(p.accessToken)).expect(200)).body,
        (b: { notifications: { type: string }[]; unread: number }) => b.notifications.length >= 2,
      );
      expect(list.notifications.map((n: { type: string }) => n.type)).toEqual([
        'trip.arrived',
        'trip.accepted',
      ]);
      expect(list.unread).toBe(2);

      const push = t.app.get<LogPushProvider>(PUSH_PROVIDER);
      expect(
        push.sent.some(
          (s) =>
            s.tokens.includes(`fcm-test-token-${p.user.id}`) &&
            s.message.title === 'Your driver has arrived',
        ),
      ).toBe(true);

      await t.http().post('/notifications/read-all').set(bearer(p.accessToken)).expect(204);
      expect(
        (await t.http().get('/notifications').set(bearer(p.accessToken)).expect(200)).body.unread,
      ).toBe(0);
    });

    it("a user cannot mark someone else's notification as read", async () => {
      const { p } = await acceptedTrip();
      const mine = await eventually(
        async () =>
          (await t.http().get('/notifications').set(bearer(p.accessToken))).body.notifications,
        (n: { id: string }[]) => n.length > 0,
      );
      const other = await loginAs(t, 'passenger');
      await t
        .http()
        .post(`/notifications/${mine[0]!.id}/read`)
        .set(bearer(other.accessToken))
        .expect(404);
    });

    it('a device token moves to the account that registered it most recently', async () => {
      const a = await loginAs(t, 'passenger');
      const b = await loginAs(t, 'passenger');
      const token = `shared-phone-token-${Date.now()}`;
      await t
        .http()
        .post('/devices')
        .set(bearer(a.accessToken))
        .send({ token, platform: 'android' })
        .expect(204);
      await t
        .http()
        .post('/devices')
        .set(bearer(b.accessToken))
        .send({ token, platform: 'android' })
        .expect(204);
      const row = await t.db
        .selectFrom('device_tokens')
        .select('user_id')
        .where('fcm_token', '=', token)
        .executeTakeFirstOrThrow();
      expect(row.user_id).toBe(b.user.id);
    });

    it('operations can broadcast to approved drivers (audited); support cannot', async () => {
      await readyDriver(t, { lat: 9.36, lng: 42.8, online: false });
      const res = await t
        .http()
        .post('/admin/notifications')
        .set(admin(ops))
        .send({
          audience: 'approved_drivers',
          title: 'Pilot meeting',
          body: 'Drivers meeting on Saturday at 10:00.',
        })
        .expect(201);
      expect(res.body.recipients).toBeGreaterThan(0);
      await t
        .http()
        .post('/admin/notifications')
        .set(admin(support))
        .send({ audience: 'all_drivers', title: 'x', body: 'y' })
        .expect(403);
      const audit = await t.db
        .selectFrom('audit_logs')
        .select('after')
        .where('action', '=', 'notification.broadcast')
        .executeTakeFirstOrThrow();
      expect(audit.after).toMatchObject({ audience: 'approved_drivers', title: 'Pilot meeting' });
    });
  });

  describe('admin operations', () => {
    it('dashboard counts come from real records', async () => {
      const before = await t.http().get('/admin/dashboard').set(admin(ops)).expect(200);
      await acceptedTrip();
      const after = await t.http().get('/admin/dashboard').set(admin(ops)).expect(200);
      expect(after.body.counts.active_trips).toBe(before.body.counts.active_trips + 1);
      expect(after.body.counts.trips_today).toBe(before.body.counts.trips_today + 1);
      // Support staff don't get the reports view.
      await t.http().get('/admin/dashboard').set(admin(support)).expect(403);
    });

    it('daily report covers every day in range, including days with no trips', async () => {
      const res = await t.http().get('/admin/reports/trips?days=7').set(admin(finance)).expect(200);
      expect(res.body.days).toHaveLength(7);
      expect(res.body.days[6].requested).toBeGreaterThan(0);
    });

    it('live map shows online drivers with freshness', async () => {
      const d = await readyDriver(t, { lat: 9.355, lng: 42.79 });
      const res = await t.http().get('/admin/live-drivers').set(admin(support)).expect(200);
      const row = res.body.drivers.find((x: { driver_id: string }) => x.driver_id === d.id);
      expect(row).toMatchObject({ isLive: true, on_trip: false });
    });

    it('trip detail shows the full event trail; staff can cancel a trip in progress (audited)', async () => {
      const { id, d } = await acceptedTrip();
      await t.http().post(`/trips/${id}/arrived`).set(bearer(d.token)).expect(200);
      await t
        .http()
        .post(`/trips/${id}/start`)
        .set(bearer(d.token))
        .send({ pin: await ridePin(t, id) })
        .expect(200);
      await t.http().post(`/admin/trips/${id}/cancel`).set(admin(support)).send({}).expect(400);
      await t
        .http()
        .post(`/admin/trips/${id}/cancel`)
        .set(admin(support))
        .send({ reason: 'Emergency reported by passenger' })
        .expect(204);
      const detail = await t.http().get(`/admin/trips/${id}`).set(admin(support)).expect(200);
      expect(detail.body.trip.status).toBe('cancelled');
      expect(detail.body.trip.cancelled_by).toBe('admin');
      expect(detail.body.trip.quote_hash).toBeUndefined();
      expect(detail.body.events.map((e: { to_status: string }) => e.to_status)).toEqual([
        'searching',
        'accepted',
        'arrived',
        'in_progress',
        'cancelled',
      ]);
      // Finance can't cancel trips.
      await t
        .http()
        .post(`/admin/trips/${id}/cancel`)
        .set(admin(finance))
        .send({ reason: 'test' })
        .expect(403);
    });

    it('passengers can be listed, suspended and reinstated by operations only', async () => {
      const p = await loginAs(t, 'passenger');
      const list = await t
        .http()
        .get(`/admin/passengers?search=${encodeURIComponent(p.user.phone.slice(-6))}`)
        .set(admin(support))
        .expect(200);
      expect(list.body.passengers.map((x: { id: string }) => x.id)).toContain(p.user.id);
      await t
        .http()
        .post(`/admin/passengers/${p.user.id}/suspend`)
        .set(admin(support))
        .send({ reason: 'abuse' })
        .expect(403);
      await t
        .http()
        .post(`/admin/passengers/${p.user.id}/suspend`)
        .set(admin(ops))
        .send({ reason: 'Repeated no-shows' })
        .expect(204);
      const q = await t
        .http()
        .post('/quotes')
        .set(bearer(p.accessToken))
        .send({ pickup: PICKUP, destination: DEST })
        .expect(403);
      expect(q.body.error.code).toBe('ACCOUNT_SUSPENDED');
      await t
        .http()
        .post(`/admin/passengers/${p.user.id}/reinstate`)
        .set(admin(ops))
        .send({})
        .expect(204);
      await t
        .http()
        .post('/quotes')
        .set(bearer(p.accessToken))
        .send({ pickup: PICKUP, destination: DEST })
        .expect(200);
    });
  });
});

describe('Rate limiting (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await startTestApp({ RATE_LIMIT_ENABLED: 'true' });
    await seedDevelopment(t.db);
  });

  afterAll(async () => {
    await t.close();
  });

  it('limits quote requests per user to 20 a minute, with Retry-After', async () => {
    const p = await loginAs(t, 'passenger');
    const results: number[] = [];
    for (let i = 0; i < 22; i++) {
      results.push(
        (
          await t
            .http()
            .post('/quotes')
            .set('Authorization', `Bearer ${p.accessToken}`)
            .send({ pickup: PICKUP, destination: DEST, categories: ['car'] })
        ).status,
      );
    }
    expect(results.slice(0, 20).every((s) => s === 200)).toBe(true);
    const limited = await t
      .http()
      .post('/quotes')
      .set('Authorization', `Bearer ${p.accessToken}`)
      .send({ pickup: PICKUP, destination: DEST });
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    // Another user is unaffected.
    const other = await loginAs(t, 'passenger');
    await t
      .http()
      .post('/quotes')
      .set('Authorization', `Bearer ${other.accessToken}`)
      .send({ pickup: PICKUP, destination: DEST })
      .expect(200);
  });

  it('the health check is never rate limited', async () => {
    for (let i = 0; i < 130; i++) await t.http().get('/health').expect(200);
  });

  it('counter windows reset', () => {
    const c = new FixedWindowCounter();
    const rule = { name: 'x', limit: 2, windowSeconds: 1 };
    expect(c.hit('k', rule, 0).allowed).toBe(true);
    expect(c.hit('k', rule, 10).allowed).toBe(true);
    expect(c.hit('k', rule, 20).allowed).toBe(false);
    expect(c.hit('k', rule, 1001).allowed).toBe(true);
  });
});
