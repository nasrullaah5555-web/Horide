import { sql } from 'kysely';
import { DriverEligibilityService } from '../src/modules/drivers/driver-eligibility.service';
import { adminLogin, type AdminSession } from './helpers/admin';
import { loginAs, startTestApp, type TestApp } from './helpers/app';
import { createAdmin, createDriver } from './helpers/fixtures';

describe('Driver subscriptions and eligibility (e2e)', () => {
  let t: TestApp;
  let finance: AdminSession;
  let support: AdminSession;
  let planId: string;
  let verifierId: string;

  beforeAll(async () => {
    t = await startTestApp();
    finance = await adminLogin(t, ['finance']);
    support = await adminLogin(t, ['support']);
    verifierId = (await createAdmin(t.db)).id;
    const plan = await t
      .http()
      .post('/admin/subscription-plans')
      .set({ Cookie: finance.cookie, 'X-CSRF-Token': finance.csrf })
      .send({ name: 'Monthly test', price: 500, durationDays: 30 });
    expect(plan.status).toBe(201);
    planId = plan.body.id;
  });

  afterAll(async () => {
    await t.close();
  });

  const asFinance = () => ({ Cookie: finance.cookie, 'X-CSRF-Token': finance.csrf });

  /** An approved driver who logs in through the real flow, with an approved vehicle. */
  async function approvedDriver() {
    const login = await loginAs(t, 'driver');
    await t.db
      .updateTable('driver_profiles')
      .set({ approval_status: 'approved', approved_by: verifierId, approved_at: new Date() })
      .where('user_id', '=', login.user.id)
      .execute();
    await t.db
      .insertInto('vehicles')
      .values({
        driver_id: login.user.id,
        category: 'car',
        make: 'Toyota',
        model: 'Vitz',
        colour: 'Silver',
        year: 2014,
        plate_number: `SUB-${Date.now() % 1e7}`,
        approval_status: 'approved',
        approved_by: verifierId,
        approved_at: new Date(),
        rejection_reason: null,
      })
      .execute();
    return login;
  }

  const pay = (driverId: string, extra: object = {}) =>
    t
      .http()
      .post('/admin/subscriptions')
      .set(asFinance())
      .send({
        driverId,
        planId,
        amount: 500,
        method: 'cash',
        receivedAt: new Date().toISOString(),
        ...extra,
      });

  it('recording a payment makes an approved driver eligible', async () => {
    const d = await approvedDriver();
    const before = await t
      .http()
      .get('/driver/eligibility')
      .set('Authorization', `Bearer ${d.accessToken}`)
      .expect(200);
    expect(before.body).toMatchObject({ eligible: false, reasons: ['SUBSCRIPTION_INACTIVE'] });

    await pay(d.user.id).expect(201);
    const after = await t
      .http()
      .get('/driver/eligibility')
      .set('Authorization', `Bearer ${d.accessToken}`)
      .expect(200);
    expect(after.body.eligible).toBe(true);
  });

  it('renewing early extends from the current end date, without overlap or lost days', async () => {
    const d = await approvedDriver();
    const first = await pay(d.user.id).expect(201);
    const second = await pay(d.user.id).expect(201);
    expect(second.body.subscription.starts_at).toBe(first.body.subscription.ends_at);
    const days =
      (new Date(second.body.subscription.ends_at).getTime() -
        new Date(first.body.subscription.starts_at).getTime()) /
      86_400_000;
    expect(Math.round(days)).toBe(60);
  });

  it('concurrent renewals for one driver never overlap', async () => {
    const d = await approvedDriver();
    const results = await Promise.all([pay(d.user.id), pay(d.user.id), pay(d.user.id)]);
    expect(results.every((r) => r.status === 201)).toBe(true);
    const subs = await t.db
      .selectFrom('subscriptions')
      .select(['starts_at', 'ends_at'])
      .where('driver_id', '=', d.user.id)
      .orderBy('starts_at')
      .execute();
    for (let i = 1; i < subs.length; i++) {
      expect(new Date(subs[i]!.starts_at).getTime()).toBe(new Date(subs[i - 1]!.ends_at).getTime());
    }
  });

  it('refuses a wrong amount, a future date, and eBirr without a reference', async () => {
    const d = await approvedDriver();
    expect((await pay(d.user.id, { amount: 400 }).expect(400)).body.error.code).toBe(
      'AMOUNT_MISMATCH',
    );
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect((await pay(d.user.id, { receivedAt: future }).expect(400)).body.error.code).toBe(
      'FUTURE_PAYMENT_DATE',
    );
    expect((await pay(d.user.id, { method: 'ebirr' }).expect(400)).body.error.code).toBe(
      'REFERENCE_REQUIRED',
    );
    await pay(d.user.id, { method: 'ebirr', reference: 'EB123456' }).expect(201);
  });

  it('an expired subscription makes the driver ineligible for new offers', async () => {
    const d = await approvedDriver();
    const res = await pay(d.user.id).expect(201);
    await sql`UPDATE subscriptions SET starts_at = now() - interval '31 days', ends_at = now() - interval '1 second'
              WHERE id = ${res.body.subscription.id}`.execute(t.db);
    const e = await t
      .http()
      .get('/driver/eligibility')
      .set('Authorization', `Bearer ${d.accessToken}`)
      .expect(200);
    expect(e.body).toMatchObject({ eligible: false, reasons: ['SUBSCRIPTION_INACTIVE'] });
  });

  it('cancelling is audited with a reason', async () => {
    const d = await approvedDriver();
    const res = await pay(d.user.id).expect(201);
    await t
      .http()
      .post(`/admin/subscriptions/${res.body.subscription.id}/cancel`)
      .set(asFinance())
      .send({})
      .expect(400);
    await t
      .http()
      .post(`/admin/subscriptions/${res.body.subscription.id}/cancel`)
      .set(asFinance())
      .send({ reason: 'Recorded for the wrong driver' })
      .expect(204);
    const e = await t
      .http()
      .get('/driver/eligibility')
      .set('Authorization', `Bearer ${d.accessToken}`)
      .expect(200);
    expect(e.body.eligible).toBe(false);
  });

  it('support staff cannot record payments or create plans', async () => {
    const d = await approvedDriver();
    const asSupport = { Cookie: support.cookie, 'X-CSRF-Token': support.csrf };
    await t
      .http()
      .post('/admin/subscriptions')
      .set(asSupport)
      .send({
        driverId: d.user.id,
        planId,
        amount: 500,
        method: 'cash',
        receivedAt: new Date().toISOString(),
      })
      .expect(403);
    await t
      .http()
      .post('/admin/subscription-plans')
      .set(asSupport)
      .send({ name: 'x', price: 1, durationDays: 1 })
      .expect(403);
  });

  it('the driver can see their own subscription history only', async () => {
    const a = await approvedDriver();
    const b = await approvedDriver();
    await pay(a.user.id).expect(201);
    const mine = await t
      .http()
      .get('/driver/subscriptions')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .expect(200);
    const theirs = await t
      .http()
      .get('/driver/subscriptions')
      .set('Authorization', `Bearer ${b.accessToken}`)
      .expect(200);
    expect(mine.body.active).not.toBeNull();
    expect(theirs.body.history).toHaveLength(0);
  });

  it('unapproved drivers with a subscription are still not eligible', async () => {
    const d = await createDriver(t.db);
    await pay(d.id).expect(201);
    const elig = await t.app.get(DriverEligibilityService).evaluate(d.id);
    expect(elig.eligible).toBe(false);
    expect(elig.reasons).toEqual(['DRIVER_NOT_APPROVED', 'NO_APPROVED_VEHICLE']);
  });
});
