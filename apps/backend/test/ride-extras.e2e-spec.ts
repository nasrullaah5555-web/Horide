import { sql } from 'kysely';
import { seedDevelopment } from '../src/database/seed-dev';
import { adminLogin, type AdminSession } from './helpers/admin';
import { loginAs, startTestApp, type TestApp, ridePin } from './helpers/app';
import { readyDriver } from './helpers/drivers';

const PICKUP = { lat: 9.3505, lng: 42.7979 };
const DEST = { lat: 9.3655, lng: 42.8079 };
const FURTHER = { lat: 9.3805, lng: 42.8179 };

describe('Destination change, payments, ratings, complaints, emergencies (e2e)', () => {
  let t: TestApp;
  let finance: AdminSession;
  let support: AdminSession;

  beforeAll(async () => {
    t = await startTestApp();
    await seedDevelopment(t.db);
    finance = await adminLogin(t, ['finance']);
    support = await adminLogin(t, ['support']);
  });

  afterAll(async () => {
    await t.close();
  });

  beforeEach(async () => {
    await t.db.updateTable('driver_locations').set({ is_online: false }).execute();
  });

  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const admin = (s: AdminSession) => ({ Cookie: s.cookie, 'X-CSRF-Token': s.csrf });

  /** A trip accepted by a fresh driver; optionally driven through to a given step. */
  async function trip(
    until: 'accepted' | 'in_progress' | 'completed' = 'accepted',
    paymentMethod: 'cash' | 'ebirr' = 'cash',
  ) {
    const d = await readyDriver(t, { lat: PICKUP.lat + 0.001, lng: PICKUP.lng });
    const p = await loginAs(t, 'passenger');
    const q = await t
      .http()
      .post('/quotes')
      .set(bearer(p.accessToken))
      .send({ pickup: PICKUP, destination: DEST, categories: ['car'], paymentMethod })
      .expect(200);
    const booked = await t
      .http()
      .post('/trips')
      .set(bearer(p.accessToken))
      .send({ quoteToken: q.body.quotes[0].quoteToken })
      .expect(201);
    const id = booked.body.id as string;
    await t.http().post(`/trips/${id}/accept`).set(bearer(d.token)).expect(200);
    const steps =
      until === 'accepted'
        ? []
        : until === 'in_progress'
          ? ['arrived', 'start']
          : ['arrived', 'start', 'complete'];
    for (const s of steps)
      await t
        .http()
        .post(`/trips/${id}/${s}`)
        .set(bearer(d.token))
        .send(s === 'start' ? { pin: await ridePin(t, id) } : {})
        .expect(200);
    return { id, p, d, fare: q.body.quotes[0].fare as string };
  }

  describe('destination change (FR-08)', () => {
    it('proposes a new server price; the fare changes only after the passenger approves', async () => {
      const { id, p, fare } = await trip('in_progress');
      const proposal = await t
        .http()
        .post(`/trips/${id}/destination-change`)
        .set(bearer(p.accessToken))
        .send({ destination: FURTHER, destinationText: 'Jijiga University' })
        .expect(200);
      expect(BigInt(proposal.body.newFare)).toBeGreaterThan(BigInt(fare));
      expect(proposal.body.currentFare).toBe(fare);

      const before = await t.http().get(`/trips/${id}`).set(bearer(p.accessToken)).expect(200);
      expect(before.body.fare.locked).toBe(fare); // nothing changed yet

      const approved = await t
        .http()
        .post(`/trips/${id}/destination-change/${proposal.body.changeId}/approve`)
        .set(bearer(p.accessToken))
        .expect(200);
      expect(approved.body.fare.locked).toBe(proposal.body.newFare);
      expect(approved.body.destination.text).toBe('Jijiga University');
      // Approving twice does nothing more.
      await t
        .http()
        .post(`/trips/${id}/destination-change/${proposal.body.changeId}/approve`)
        .set(bearer(p.accessToken))
        .expect(409);
    });

    it('rejecting keeps the original destination and fare', async () => {
      const { id, p, fare } = await trip();
      const proposal = await t
        .http()
        .post(`/trips/${id}/destination-change`)
        .set(bearer(p.accessToken))
        .send({ destination: FURTHER })
        .expect(200);
      const res = await t
        .http()
        .post(`/trips/${id}/destination-change/${proposal.body.changeId}/reject`)
        .set(bearer(p.accessToken))
        .expect(200);
      expect(res.body.fare.locked).toBe(fare);
    });

    it('an expired proposal cannot be approved', async () => {
      const { id, p } = await trip();
      const proposal = await t
        .http()
        .post(`/trips/${id}/destination-change`)
        .set(bearer(p.accessToken))
        .send({ destination: FURTHER })
        .expect(200);
      await sql`UPDATE trip_destination_changes SET expires_at = now() - interval '1 second' WHERE id = ${proposal.body.changeId}`.execute(
        t.db,
      );
      const res = await t
        .http()
        .post(`/trips/${id}/destination-change/${proposal.body.changeId}/approve`)
        .set(bearer(p.accessToken))
        .expect(409);
      expect(res.body.error.code).toBe('CHANGE_EXPIRED');
    });

    it('a destination outside the service area is refused; drivers and strangers cannot change it', async () => {
      const { id, p, d } = await trip();
      const out = await t
        .http()
        .post(`/trips/${id}/destination-change`)
        .set(bearer(p.accessToken))
        .send({ destination: { lat: 9.03, lng: 38.74 } })
        .expect(422);
      expect(out.body.error.code).toBe('DESTINATION_OUTSIDE_SERVICE_AREA');
      await t
        .http()
        .post(`/trips/${id}/destination-change`)
        .set(bearer(d.token))
        .send({ destination: FURTHER })
        .expect(403);
      const stranger = await loginAs(t, 'passenger');
      await t
        .http()
        .post(`/trips/${id}/destination-change`)
        .set(bearer(stranger.accessToken))
        .send({ destination: FURTHER })
        .expect(404);
    });
  });

  describe('ride payment records', () => {
    it('driver records cash, passenger confirms → confirmed; receipt says Musride did not collect it', async () => {
      const { id, p, d, fare } = await trip('completed');
      await t
        .http()
        .post(`/trips/${id}/payment/received`)
        .set(bearer(d.token))
        .send({ method: 'cash' })
        .expect(200);
      const r = await t
        .http()
        .post(`/trips/${id}/payment/confirm`)
        .set(bearer(p.accessToken))
        .expect(200);
      expect(r.body.payment_status).toBe('confirmed');
      expect(r.body.final_fare).toBe(fare);
      expect(r.body.note).toMatch(/does not collect/);
    });

    it('eBirr needs a reference; cash must not have one', async () => {
      const { id, d } = await trip('completed', 'ebirr');
      expect(
        (
          await t
            .http()
            .post(`/trips/${id}/payment/received`)
            .set(bearer(d.token))
            .send({ method: 'ebirr' })
            .expect(400)
        ).body.error.code,
      ).toBe('REFERENCE_REQUIRED');
      expect(
        (
          await t
            .http()
            .post(`/trips/${id}/payment/received`)
            .set(bearer(d.token))
            .send({ method: 'cash', ebirrReference: 'TX1234' })
            .expect(400)
        ).body.error.code,
      ).toBe('REFERENCE_NOT_ALLOWED');
      const ok = await t
        .http()
        .post(`/trips/${id}/payment/received`)
        .set(bearer(d.token))
        .send({ method: 'ebirr', ebirrReference: 'FT26309ABC' })
        .expect(200);
      expect(ok.body).toMatchObject({
        method: 'ebirr',
        ebirr_reference: 'FT26309ABC',
        payment_status: 'driver_recorded',
      });
    });

    it('cannot be recorded before the trip is completed, by a stranger, or twice', async () => {
      const { id, p, d } = await trip('in_progress');
      await t
        .http()
        .post(`/trips/${id}/payment/received`)
        .set(bearer(d.token))
        .send({ method: 'cash' })
        .expect(404);
      await t.http().post(`/trips/${id}/complete`).set(bearer(d.token)).expect(200);
      const other = await readyDriver(t, { lat: 9.4, lng: 42.8 });
      await t
        .http()
        .post(`/trips/${id}/payment/received`)
        .set(bearer(other.token))
        .send({ method: 'cash' })
        .expect(404);
      await t.http().post(`/trips/${id}/payment/confirm`).set(bearer(p.accessToken)).expect(200);
      await t.http().post(`/trips/${id}/payment/confirm`).set(bearer(p.accessToken)).expect(409);
    });

    it('a dispute goes to finance; support cannot resolve; once resolved nobody can change it', async () => {
      const { id, p, d } = await trip('completed');
      await t
        .http()
        .post(`/trips/${id}/payment/received`)
        .set(bearer(d.token))
        .send({ method: 'cash' })
        .expect(200);
      const disputed = await t
        .http()
        .post(`/trips/${id}/payment/dispute`)
        .set(bearer(p.accessToken))
        .send({ note: 'Driver asked for more than the app price' })
        .expect(200);
      expect(disputed.body.payment_status).toBe('disputed');

      const list = await t
        .http()
        .get('/admin/payments?status=disputed')
        .set(admin(finance))
        .expect(200);
      const payment = list.body.payments.find((x: { trip_id: string }) => x.trip_id === id);
      expect(payment.confirmations).toHaveLength(2);

      await t
        .http()
        .post(`/admin/payments/${payment.id}/resolve`)
        .set(admin(support))
        .send({ note: 'Spoke to both' })
        .expect(403);
      await t
        .http()
        .post(`/admin/payments/${payment.id}/resolve`)
        .set(admin(finance))
        .send({ note: 'Driver refunded the extra 20 ETB' })
        .expect(204);
      await t
        .http()
        .post(`/trips/${id}/payment/dispute`)
        .set(bearer(d.token))
        .send({ note: 'Trying to reopen' })
        .expect(409);
      const audit = await t.db
        .selectFrom('audit_logs')
        .select('actor_id')
        .where('action', '=', 'payment.dispute_resolved')
        .where('entity_id', '=', payment.id)
        .executeTakeFirstOrThrow();
      expect(audit.actor_id).toBe(finance.id);
    });
  });

  describe('ratings', () => {
    it("a passenger rates once after completion and the driver's average is recalculated", async () => {
      const first = await trip('completed');
      await t
        .http()
        .post(`/trips/${first.id}/rating`)
        .set(bearer(first.p.accessToken))
        .send({ stars: 5 })
        .expect(201);
      await t
        .http()
        .post(`/trips/${first.id}/rating`)
        .set(bearer(first.p.accessToken))
        .send({ stars: 1 })
        .expect(409);
      // Driver rates the passenger too; this must not affect the driver's average.
      await t
        .http()
        .post(`/trips/${first.id}/rating`)
        .set(bearer(first.d.token))
        .send({ stars: 2 })
        .expect(201);
      const profile = await t.db
        .selectFrom('driver_profiles')
        .select(['rating_avg', 'rating_count'])
        .where('user_id', '=', first.d.id)
        .executeTakeFirstOrThrow();
      expect(profile).toEqual({ rating_avg: '5.00', rating_count: 1 });
    });

    it('cannot rate an unfinished trip or a stranger’s trip', async () => {
      const { id, p } = await trip('in_progress');
      await t
        .http()
        .post(`/trips/${id}/rating`)
        .set(bearer(p.accessToken))
        .send({ stars: 4 })
        .expect(409);
      const stranger = await loginAs(t, 'passenger');
      await t
        .http()
        .post(`/trips/${id}/rating`)
        .set(bearer(stranger.accessToken))
        .send({ stars: 1 })
        .expect(404);
    });
  });

  describe('complaints and emergencies', () => {
    it('a complaint about a trip names the other party; support handles it with an audited resolution', async () => {
      const { id, p, d } = await trip('completed');
      const c = await t
        .http()
        .post('/complaints')
        .set(bearer(p.accessToken))
        .send({
          tripId: id,
          category: 'behaviour',
          description: 'Driver was on the phone while driving',
        })
        .expect(201);
      const row = await t.db
        .selectFrom('complaints')
        .select('against_user_id')
        .where('id', '=', c.body.id)
        .executeTakeFirstOrThrow();
      expect(row.against_user_id).toBe(d.id);

      await t
        .http()
        .post(`/admin/complaints/${c.body.id}`)
        .set(admin(support))
        .send({ status: 'resolved' })
        .expect(400);
      await t
        .http()
        .post(`/admin/complaints/${c.body.id}`)
        .set(admin(support))
        .send({ status: 'resolved', resolution: 'Driver warned' })
        .expect(204);
      const mine = await t.http().get('/complaints').set(bearer(p.accessToken)).expect(200);
      expect(mine.body.complaints[0]).toMatchObject({
        status: 'resolved',
        resolution: 'Driver warned',
      });
      // Finance cannot handle complaints.
      await t
        .http()
        .post(`/admin/complaints/${c.body.id}`)
        .set(admin(finance))
        .send({ status: 'closed', resolution: 'x x x' })
        .expect(403);
    });

    it('the emergency button records the alert and returns the public emergency numbers', async () => {
      const { id, p } = await trip('in_progress');
      const res = await t
        .http()
        .post('/emergency')
        .set(bearer(p.accessToken))
        .send({ tripId: id, position: PICKUP })
        .expect(201);
      expect(res.body.emergencyNumbers).toEqual(
        expect.arrayContaining([{ service: 'Police', number: '991' }]),
      );
      const open = await t
        .http()
        .get('/admin/emergencies?open=true')
        .set(admin(support))
        .expect(200);
      const alert = open.body.emergencies.find((e: { id: string }) => e.id === res.body.id);
      expect(alert).toMatchObject({ trip_id: id, lat: PICKUP.lat, lng: PICKUP.lng });
      await t
        .http()
        .post(`/admin/emergencies/${res.body.id}/handle`)
        .set(admin(support))
        .send({ notes: 'Called passenger, safe' })
        .expect(204);
      await t
        .http()
        .post(`/admin/emergencies/${res.body.id}/handle`)
        .set(admin(support))
        .send({ notes: 'again' })
        .expect(409);
    });

    it('an emergency is never refused because of a wrong trip id', async () => {
      const p = await loginAs(t, 'passenger');
      const res = await t
        .http()
        .post('/emergency')
        .set(bearer(p.accessToken))
        .send({ tripId: '00000000-0000-4000-8000-000000000000' })
        .expect(201);
      expect(res.body.id).toBeDefined();
    });
  });
});
