import { Kysely, sql } from 'kysely';
import type { DB } from '../src/database/types';
import { resetSchema, testDatabase } from './helpers/db';
import {
  createAdmin,
  createDriver,
  createFareVersion,
  createPassenger,
  createTrip,
  JIJIGA,
  point,
} from './helpers/fixtures';

/** Proves the business rules that the database itself enforces (migrations 0002 and 0003). */
describe('Migrations: fleet, pricing, trips, payments, subscriptions', () => {
  let db: Kysely<DB>;
  let adminId: string;

  beforeAll(async () => {
    db = testDatabase();
    await resetSchema(db);
    adminId = (await createAdmin(db)).id;
  });

  afterAll(async () => {
    await db.destroy();
  });

  describe('vehicles and documents', () => {
    it('rejects duplicate plates and badly formatted plates', async () => {
      const d = await createDriver(db);
      const plate = await db
        .selectFrom('vehicles')
        .select('plate_number')
        .where('id', '=', d.vehicleId)
        .executeTakeFirstOrThrow();
      const base = {
        driver_id: d.id,
        category: 'car' as const,
        make: 'Toyota',
        model: 'Vitz',
        colour: 'Red',
        year: 2010,
        approved_by: null,
        approved_at: null,
        rejection_reason: null,
      };
      await expect(
        db
          .insertInto('vehicles')
          .values({ ...base, plate_number: plate.plate_number })
          .execute(),
      ).rejects.toThrow(/duplicate key/);
      await expect(
        db
          .insertInto('vehicles')
          .values({ ...base, plate_number: 'aa 12 34' })
          .execute(),
      ).rejects.toThrow(/check constraint/);
    });

    it('allows only one approved active vehicle per driver', async () => {
      const d = await createDriver(db, { approvedBy: adminId });
      await expect(
        db
          .insertInto('vehicles')
          .values({
            driver_id: d.id,
            category: 'bajaj',
            make: 'Bajaj',
            model: 'RE',
            colour: 'Blue',
            year: 2018,
            plate_number: `SECOND-${Date.now() % 100000}`,
            approval_status: 'approved',
            approved_by: adminId,
            approved_at: new Date(),
            rejection_reason: null,
          })
          .execute(),
      ).rejects.toThrow(/vehicles_one_active_per_driver/);
    });

    it('never stores a public URL for a document and limits type and size', async () => {
      const d = await createDriver(db);
      const doc = {
        driver_id: d.id,
        vehicle_id: null,
        type: 'national_id' as const,
        mime_type: 'image/jpeg',
        size_bytes: 1000,
        sha256: 'a'.repeat(64),
        reviewed_by: null,
        reviewed_at: null,
        rejection_reason: null,
        expires_on: null,
      };
      await expect(
        db
          .insertInto('driver_documents')
          .values({ ...doc, storage_key: 'https://bucket.example/id.jpg' })
          .execute(),
      ).rejects.toThrow(/check constraint/);
      await expect(
        db
          .insertInto('driver_documents')
          .values({ ...doc, storage_key: `k-${Date.now()}`, mime_type: 'text/html' })
          .execute(),
      ).rejects.toThrow(/check constraint/);
      await expect(
        db
          .insertInto('driver_documents')
          .values({ ...doc, storage_key: `k2-${Date.now()}`, size_bytes: 9_000_000 })
          .execute(),
      ).rejects.toThrow(/check constraint/);
    });

    it('requires a vehicle for vehicle registration and insurance documents', async () => {
      const d = await createDriver(db);
      await expect(
        db
          .insertInto('driver_documents')
          .values({
            driver_id: d.id,
            vehicle_id: null,
            type: 'insurance',
            storage_key: `k3-${Date.now()}`,
            mime_type: 'application/pdf',
            size_bytes: 1000,
            sha256: 'b'.repeat(64),
            reviewed_by: null,
            reviewed_at: null,
            rejection_reason: null,
            expires_on: null,
          })
          .execute(),
      ).rejects.toThrow(/vehicle_documents_need_vehicle/);
    });
  });

  describe('pricing', () => {
    it('fare versions cannot be edited or deleted', async () => {
      const v = await createFareVersion(db);
      await expect(
        db.updateTable('fare_versions').set({ base_fare: 1 }).where('id', '=', v.id).execute(),
      ).rejects.toThrow(/immutable/);
      await expect(db.deleteFrom('fare_versions').where('id', '=', v.id).execute()).rejects.toThrow(
        /immutable/,
      );
    });

    it('a category cannot point at another category’s fare version', async () => {
      const bajaj = await createFareVersion(db, 'bajaj');
      await expect(
        db
          .insertInto('fare_settings')
          .values({ category: 'car', current_version_id: bajaj.id, updated_by: null })
          .execute(),
      ).rejects.toThrow(/fare_settings_version_fk/);
    });
  });

  describe('trips', () => {
    it('cannot be accepted without a driver, vehicle and locked fare', async () => {
      const p = await createPassenger(db);
      const fv = await createFareVersion(db);
      const t = await createTrip(db, { passengerId: p.id, fareVersionId: fv.id });
      await expect(
        db.updateTable('trips').set({ status: 'accepted' }).where('id', '=', t.id).execute(),
      ).rejects.toThrow(/trips_driver_required/);

      const d = await createDriver(db, { approvedBy: adminId });
      await expect(
        db
          .updateTable('trips')
          .set({ status: 'accepted', driver_id: d.id })
          .where('id', '=', t.id)
          .execute(),
      ).rejects.toThrow(/trips_fare_locked_with_driver/);
    });

    it('a passenger can only have one open trip', async () => {
      const p = await createPassenger(db);
      const fv = await createFareVersion(db);
      await createTrip(db, { passengerId: p.id, fareVersionId: fv.id });
      await expect(createTrip(db, { passengerId: p.id, fareVersionId: fv.id })).rejects.toThrow(
        /trips_one_open_per_passenger/,
      );
    });

    it('a driver can only be on one active trip', async () => {
      const fv = await createFareVersion(db);
      const d = await createDriver(db, { approvedBy: adminId });
      const accept = (tripId: string) =>
        db
          .updateTable('trips')
          .set({
            status: 'accepted',
            driver_id: d.id,
            vehicle_id: d.vehicleId,
            locked_fare: 8000,
            accepted_at: new Date(),
          })
          .where('id', '=', tripId)
          .execute();
      const t1 = await createTrip(db, {
        passengerId: (await createPassenger(db)).id,
        fareVersionId: fv.id,
      });
      const t2 = await createTrip(db, {
        passengerId: (await createPassenger(db)).id,
        fareVersionId: fv.id,
      });
      await accept(t1.id);
      await expect(accept(t2.id)).rejects.toThrow(/trips_one_active_per_driver/);
    });

    it('cannot be priced with a fare version of another category', async () => {
      const p = await createPassenger(db);
      const bajaj = await createFareVersion(db, 'bajaj');
      await expect(
        createTrip(db, { passengerId: p.id, fareVersionId: bajaj.id, category: 'car' }),
      ).rejects.toThrow(/trips_fare_version_fk/);
    });

    it('supports geographic distance queries', async () => {
      const { rows } = await sql<{ m: number }>`
        SELECT ST_Distance(${point(JIJIGA.lat, JIJIGA.lng)}, ${point(JIJIGA.lat + 0.01, JIJIGA.lng)}) AS m
      `.execute(db);
      // 0.01 degree of latitude is about 1.1 km.
      expect(rows[0]?.m).toBeGreaterThan(1000);
      expect(rows[0]?.m).toBeLessThan(1200);
    });
  });

  describe('payments', () => {
    it('cash payments carry no reference (eBirr and M-Pesa do); each party confirms once', async () => {
      const p = await createPassenger(db);
      const fv = await createFareVersion(db);
      const t = await createTrip(db, { passengerId: p.id, fareVersionId: fv.id });
      await expect(
        db
          .insertInto('payments')
          .values({
            trip_id: t.id,
            method: 'cash',
            amount: 8000,
            ebirr_reference: 'TX12345',
            driver_recorded_at: null,
            resolved_by: null,
            resolution_note: null,
          })
          .execute(),
      ).rejects.toThrow(/payments_reference_not_for_cash/);

      const pay = await db
        .insertInto('payments')
        .values({
          trip_id: t.id,
          method: 'ebirr',
          amount: 8000,
          ebirr_reference: 'TX12345',
          driver_recorded_at: null,
          resolved_by: null,
          resolution_note: null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const confirm = () =>
        db
          .insertInto('payment_confirmations')
          .values({ payment_id: pay.id, party: 'passenger', outcome: 'confirmed', note: null })
          .execute();
      await confirm();
      await expect(confirm()).rejects.toThrow(/payment_confirmations_once_per_party/);
    });
  });

  describe('subscriptions', () => {
    it('a driver cannot hold two overlapping active subscriptions', async () => {
      const d = await createDriver(db, { approvedBy: adminId });
      const plan = await db
        .insertInto('subscription_plans')
        .values({ name: `Monthly ${Date.now()}`, category: null, price: 50000, duration_days: 30 })
        .returning('id')
        .executeTakeFirstOrThrow();
      const sub = (start: string, end: string) =>
        db
          .insertInto('subscriptions')
          .values({
            driver_id: d.id,
            plan_id: plan.id,
            starts_at: start,
            ends_at: end,
            created_by: adminId,
          })
          .execute();
      await sub('2026-01-01T00:00:00Z', '2026-01-31T00:00:00Z');
      await expect(sub('2026-01-15T00:00:00Z', '2026-02-14T00:00:00Z')).rejects.toThrow(
        /subscriptions_no_overlap/,
      );
      // Back-to-back renewals are allowed.
      await sub('2026-01-31T00:00:00Z', '2026-03-02T00:00:00Z');
    });

    it('rejects an end date before the start date', async () => {
      const d = await createDriver(db, { approvedBy: adminId });
      const plan = await db
        .insertInto('subscription_plans')
        .values({ name: `Plan ${Date.now()}`, category: null, price: 1, duration_days: 30 })
        .returning('id')
        .executeTakeFirstOrThrow();
      await expect(
        db
          .insertInto('subscriptions')
          .values({
            driver_id: d.id,
            plan_id: plan.id,
            starts_at: '2026-02-01T00:00:00Z',
            ends_at: '2026-01-01T00:00:00Z',
            created_by: adminId,
          })
          .execute(),
      ).rejects.toThrow(/subscriptions_period_valid/);
    });
  });

  describe('ratings', () => {
    it('a user cannot rate themselves', async () => {
      const p = await createPassenger(db);
      const fv = await createFareVersion(db);
      const t = await createTrip(db, { passengerId: p.id, fareVersionId: fv.id });
      await expect(
        db
          .insertInto('ratings')
          .values({ trip_id: t.id, rater_id: p.id, ratee_id: p.id, stars: 5, comment: null })
          .execute(),
      ).rejects.toThrow(/ratings_not_self/);
    });
  });
});
