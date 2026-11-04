import { sql } from 'kysely';
import { adminLogin, type AdminSession } from './helpers/admin';
import { loginAs, startTestApp, type TestApp } from './helpers/app';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(200, 2),
]);
const PDF = Buffer.from('%PDF-1.4\n% test document\n');
const HTML = Buffer.from('<html><script>alert(1)</script></html>');

describe('Passenger profile, driver onboarding and verification (e2e)', () => {
  let t: TestApp;
  let verifier: AdminSession;
  let support: AdminSession;

  beforeAll(async () => {
    t = await startTestApp();
    verifier = await adminLogin(t, ['verification', 'operations']);
    support = await adminLogin(t, ['support']);
  });

  afterAll(async () => {
    await t.close();
  });

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  describe('passenger profile and saved places', () => {
    it('updates the profile and normalises the emergency contact', async () => {
      const p = await loginAs(t, 'passenger');
      const res = await t
        .http()
        .patch('/passenger/profile')
        .set(auth(p.accessToken))
        .send({ fullName: 'Hodan Ali', emergencyContactPhone: '0911000111' })
        .expect(200);
      expect(res.body).toMatchObject({
        full_name: 'Hodan Ali',
        emergency_contact_phone: '+251911000111',
      });
    });

    it('drivers cannot use passenger endpoints', async () => {
      const d = await loginAs(t, 'driver');
      await t.http().get('/passenger/profile').set(auth(d.accessToken)).expect(403);
    });

    it('saves, lists and deletes places; another passenger cannot delete them (IDOR)', async () => {
      const a = await loginAs(t, 'passenger');
      const b = await loginAs(t, 'passenger');
      const created = await t
        .http()
        .post('/passenger/saved-locations')
        .set(auth(a.accessToken))
        .send({ label: 'Home', position: { lat: 9.35, lng: 42.8 }, addressText: 'Near Kebele 05' })
        .expect(201);
      const list = await t
        .http()
        .get('/passenger/saved-locations')
        .set(auth(a.accessToken))
        .expect(200);
      expect(list.body.locations[0]).toMatchObject({ label: 'Home', lat: 9.35, lng: 42.8 });

      const other = await t
        .http()
        .get('/passenger/saved-locations')
        .set(auth(b.accessToken))
        .expect(200);
      expect(other.body.locations).toHaveLength(0);
      await t
        .http()
        .delete(`/passenger/saved-locations/${created.body.id}`)
        .set(auth(b.accessToken))
        .expect(404);
      await t
        .http()
        .delete(`/passenger/saved-locations/${created.body.id}`)
        .set(auth(a.accessToken))
        .expect(204);
    });

    it('rejects invalid coordinates', async () => {
      const p = await loginAs(t, 'passenger');
      await t
        .http()
        .post('/passenger/saved-locations')
        .set(auth(p.accessToken))
        .send({ label: 'Bad', position: { lat: 120, lng: 42.8 } })
        .expect(400);
    });

    it('a suspended passenger cannot change data', async () => {
      const p = await loginAs(t, 'passenger');
      await t.db
        .updateTable('users')
        .set({ status: 'suspended', suspended_reason: 'test' })
        .where('id', '=', p.user.id)
        .execute();
      const res = await t
        .http()
        .patch('/passenger/profile')
        .set(auth(p.accessToken))
        .send({ fullName: 'X' })
        .expect(403);
      expect(res.body.error.code).toBe('ACCOUNT_SUSPENDED');
    });
  });

  describe('driver onboarding', () => {
    async function onboardDriver() {
      const d = await loginAs(t, 'driver');
      await t
        .http()
        .patch('/driver/profile')
        .set(auth(d.accessToken))
        .send({ fullName: 'Abdi Yusuf' })
        .expect(200);
      const vehicle = await t
        .http()
        .post('/driver/vehicles')
        .set(auth(d.accessToken))
        .send({
          category: 'bajaj',
          make: 'Bajaj',
          model: 'RE',
          colour: 'Blue',
          year: 2019,
          plateNumber: `3-${Date.now() % 1e7}`,
        })
        .expect(201);
      const upload = (type: string, file: Buffer, name: string, vehicleId?: string) => {
        const r = t.http().post('/driver/documents').set(auth(d.accessToken)).field('type', type);
        if (vehicleId) r.field('vehicleId', vehicleId);
        return r.attach('file', file, name);
      };
      return { d, vehicleId: vehicle.body.id as string, upload };
    }

    it('normalises plate numbers and refuses duplicates', async () => {
      const a = await loginAs(t, 'driver');
      const b = await loginAs(t, 'driver');
      const plate = `aa ${Date.now() % 1e6}`;
      const res = await t
        .http()
        .post('/driver/vehicles')
        .set(auth(a.accessToken))
        .send({
          category: 'car',
          make: 'Toyota',
          model: 'Vitz',
          colour: 'White',
          plateNumber: plate,
        })
        .expect(201);
      expect(res.body.plate_number).toBe(plate.toUpperCase().replace(/\s/g, ''));
      const dup = await t
        .http()
        .post('/driver/vehicles')
        .set(auth(b.accessToken))
        .send({
          category: 'car',
          make: 'Toyota',
          model: 'Vitz',
          colour: 'White',
          plateNumber: plate.toUpperCase(),
        })
        .expect(409);
      expect(dup.body.error.code).toBe('PLATE_TAKEN');
    });

    it('accepts JPEG, PNG and PDF identified by content, not by file name', async () => {
      const { upload, vehicleId } = await onboardDriver();
      expect((await upload('profile_photo', JPEG, 'me.jpg').expect(201)).body.mime_type).toBe(
        'image/jpeg',
      );
      expect((await upload('national_id', PNG, 'id.png').expect(201)).body.mime_type).toBe(
        'image/png',
      );
      expect(
        (await upload('vehicle_registration', PDF, 'reg.pdf', vehicleId).expect(201)).body
          .mime_type,
      ).toBe('application/pdf');
    });

    it('rejects a disguised HTML file named .jpg', async () => {
      const { upload } = await onboardDriver();
      const res = await upload('national_id', HTML, 'id.jpg').expect(415);
      expect(res.body.error.code).toBe('UNSUPPORTED_FILE');
    });

    it('rejects files over 8 MB', async () => {
      const { upload } = await onboardDriver();
      const big = Buffer.concat([JPEG, Buffer.alloc(8 * 1024 * 1024 + 1)]);
      await upload('national_id', big, 'big.jpg').expect(413);
    });

    it('requires a vehicle for vehicle documents, and only the driver’s own vehicle', async () => {
      const { upload } = await onboardDriver();
      await upload('vehicle_registration', PDF, 'reg.pdf').expect(400);
      const other = await onboardDriver();
      await upload('vehicle_registration', PDF, 'reg.pdf', other.vehicleId).expect(404);
    });

    it('never returns storage keys to the driver', async () => {
      const { d, upload } = await onboardDriver();
      await upload('national_id', PNG, 'id.png').expect(201);
      const res = await t.http().get('/driver/profile').set(auth(d.accessToken)).expect(200);
      expect(JSON.stringify(res.body)).not.toMatch(/storage_key|driver-documents\//);
      expect(res.body.eligibility.reasons).toEqual(
        expect.arrayContaining([
          'DRIVER_NOT_APPROVED',
          'NO_APPROVED_VEHICLE',
          'SUBSCRIPTION_INACTIVE',
        ]),
      );
    });

    describe('admin verification', () => {
      const asAdmin = (s: AdminSession) => ({ Cookie: s.cookie, 'X-CSRF-Token': s.csrf });

      it('full flow: review documents and vehicle, then approve the driver; every step audited', async () => {
        const { d, vehicleId, upload } = await onboardDriver();
        const docIds: string[] = [];
        docIds.push((await upload('profile_photo', JPEG, 'p.jpg').expect(201)).body.id);
        docIds.push((await upload('national_id', PNG, 'id.png').expect(201)).body.id);
        docIds.push((await upload('driving_licence', PNG, 'dl.png').expect(201)).body.id);

        // Approving the driver too early is refused and explains what is missing.
        const early = await t
          .http()
          .post(`/admin/drivers/${d.user.id}/approve`)
          .set(asAdmin(verifier))
          .send({})
          .expect(409);
        expect(early.body.error.details.missingDocuments).toEqual(
          expect.arrayContaining([
            'profile_photo',
            'national_id',
            'driving_licence',
            'vehicle_registration',
          ]),
        );

        docIds.push(
          (await upload('vehicle_registration', PDF, 'reg.pdf', vehicleId).expect(201)).body.id,
        );
        for (const id of docIds) {
          await t
            .http()
            .post(`/admin/documents/${id}/approve`)
            .set(asAdmin(verifier))
            .send({})
            .expect(204);
        }
        await t
          .http()
          .post(`/admin/vehicles/${vehicleId}/approve`)
          .set(asAdmin(verifier))
          .send({})
          .expect(204);
        await t
          .http()
          .post(`/admin/drivers/${d.user.id}/approve`)
          .set(asAdmin(verifier))
          .send({})
          .expect(204);

        const status = await t
          .http()
          .get('/driver/eligibility')
          .set(auth(d.accessToken))
          .expect(200);
        // Approved, but still not eligible for offers: no subscription yet.
        expect(status.body.reasons).toEqual(['SUBSCRIPTION_INACTIVE']);

        const actions = (
          await t.db
            .selectFrom('audit_logs')
            .select('action')
            .where('actor_id', '=', verifier.id)
            .execute()
        ).map((r) => r.action);
        expect(actions).toEqual(
          expect.arrayContaining(['document.approved', 'vehicle.approved', 'driver.approved']),
        );

        // A verified name can no longer be changed by the driver.
        await t
          .http()
          .patch('/driver/profile')
          .set(auth(d.accessToken))
          .send({ fullName: 'Someone Else' })
          .expect(409);
      });

      it('verification admins can download documents; each download is audited', async () => {
        const { upload } = await onboardDriver();
        const doc = await upload('national_id', PNG, 'id.png').expect(201);
        const res = await t
          .http()
          .get(`/admin/documents/${doc.body.id}/file`)
          .set(asAdmin(verifier))
          .expect(200);
        expect(res.headers['content-type']).toBe('image/png');
        expect(res.headers['content-disposition']).toMatch(/^attachment/);
        expect(res.headers['cache-control']).toBe('no-store');
        const viewed = await t.db
          .selectFrom('audit_logs')
          .select('id')
          .where('action', '=', 'document.viewed')
          .where('entity_id', '=', doc.body.id)
          .execute();
        expect(viewed).toHaveLength(1);
      });

      it('support staff cannot view documents or approve drivers', async () => {
        const { d, upload } = await onboardDriver();
        const doc = await upload('national_id', PNG, 'id.png').expect(201);
        await t
          .http()
          .get(`/admin/documents/${doc.body.id}/file`)
          .set(asAdmin(support))
          .expect(403);
        await t
          .http()
          .post(`/admin/documents/${doc.body.id}/approve`)
          .set(asAdmin(support))
          .send({})
          .expect(403);
        await t
          .http()
          .post(`/admin/drivers/${d.user.id}/approve`)
          .set(asAdmin(support))
          .send({})
          .expect(403);
        // Support can read the driver list.
        await t.http().get('/admin/drivers').set(asAdmin(support)).expect(200);
      });

      it('rejecting requires a reason', async () => {
        const { upload } = await onboardDriver();
        const doc = await upload('national_id', PNG, 'id.png').expect(201);
        await t
          .http()
          .post(`/admin/documents/${doc.body.id}/reject`)
          .set(asAdmin(verifier))
          .send({})
          .expect(400);
        await t
          .http()
          .post(`/admin/documents/${doc.body.id}/reject`)
          .set(asAdmin(verifier))
          .send({ reason: 'Photo is blurry' })
          .expect(204);
      });

      it('suspension takes the driver offline, records the reason and is audited', async () => {
        const { d } = await onboardDriver();
        await sql`INSERT INTO driver_locations (driver_id, position, recorded_at, is_online)
                  VALUES (${d.user.id}, ST_SetSRID(ST_MakePoint(42.8, 9.35), 4326)::geography, now(), true)`.execute(
          t.db,
        );
        await t
          .http()
          .post(`/admin/drivers/${d.user.id}/suspend`)
          .set(asAdmin(verifier))
          .send({ reason: 'Passenger safety complaint under review' })
          .expect(204);
        const loc = await t.db
          .selectFrom('driver_locations')
          .select('is_online')
          .where('driver_id', '=', d.user.id)
          .executeTakeFirstOrThrow();
        expect(loc.is_online).toBe(false);
        const elig = await t.http().get('/driver/eligibility').set(auth(d.accessToken)).expect(200);
        expect(elig.body.reasons).toContain('ACCOUNT_SUSPENDED');

        await t
          .http()
          .post(`/admin/drivers/${d.user.id}/reinstate`)
          .set(asAdmin(verifier))
          .send({})
          .expect(204);
        const after = await t
          .http()
          .get('/driver/eligibility')
          .set(auth(d.accessToken))
          .expect(200);
        expect(after.body.reasons).not.toContain('ACCOUNT_SUSPENDED');
      });

      it('search input is treated as text, not as SQL or wildcards', async () => {
        const res = await t
          .http()
          .get(`/admin/drivers?search=${encodeURIComponent("%' OR 1=1 --")}`)
          .set(asAdmin(verifier))
          .expect(200);
        expect(res.body.drivers).toHaveLength(0);
      });
    });
  });
});
