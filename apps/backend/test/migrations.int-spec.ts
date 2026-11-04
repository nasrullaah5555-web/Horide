import { Kysely, sql } from 'kysely';
import { createMigrator } from '../src/database/migrator';
import type { DB } from '../src/database/types';
import { resetSchema, testDatabase } from './helpers/db';

describe('Migration 0001 identity', () => {
  let db: Kysely<DB>;

  beforeAll(async () => {
    db = testDatabase();
    await resetSchema(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('can be rolled back and re-applied cleanly', async () => {
    const migrator = createMigrator(db);
    const down = await migrator.migrateDown();
    expect(down.error).toBeUndefined();
    const up = await migrator.migrateToLatest();
    expect(up.error).toBeUndefined();
    expect(up.results?.map((r) => r.migrationName)).toEqual(['0001_identity']);
  });

  describe('users', () => {
    it('accepts Ethio Telecom (+2519) and Safaricom (+2517) numbers', async () => {
      await db
        .insertInto('users')
        .values([
          { phone: '+251911000001', role: 'passenger', suspended_reason: null },
          { phone: '+251711000001', role: 'passenger', suspended_reason: null },
        ])
        .execute();
    });

    it.each(['0911000002', '+25191100000', '+254711000002', '+251811000002', "+251911' OR 1=1"])(
      'rejects invalid phone %s',
      async (phone) => {
        await expect(
          db
            .insertInto('users')
            .values({ phone, role: 'passenger', suspended_reason: null })
            .execute(),
        ).rejects.toThrow(/check constraint/);
      },
    );

    it('allows one passenger and one driver account per phone, not two of the same', async () => {
      await db
        .insertInto('users')
        .values({ phone: '+251911000003', role: 'driver', suspended_reason: null })
        .execute();
      await db
        .insertInto('users')
        .values({ phone: '+251911000003', role: 'passenger', suspended_reason: null })
        .execute();
      await expect(
        db
          .insertInto('users')
          .values({ phone: '+251911000003', role: 'driver', suspended_reason: null })
          .execute(),
      ).rejects.toThrow(/users_phone_role_unique/);
    });

    it('requires a reason when suspending', async () => {
      const u = await db
        .insertInto('users')
        .values({ phone: '+251911000004', role: 'driver', suspended_reason: null })
        .returning('id')
        .executeTakeFirstOrThrow();
      await expect(
        db.updateTable('users').set({ status: 'suspended' }).where('id', '=', u.id).execute(),
      ).rejects.toThrow(/users_suspension_reason/);
    });

    it('maintains updated_at automatically', async () => {
      const u = await db
        .insertInto('users')
        .values({ phone: '+251911000005', role: 'passenger', suspended_reason: null })
        .returning(['id', 'updated_at'])
        .executeTakeFirstOrThrow();
      await sql`SELECT pg_sleep(0.01)`.execute(db);
      const after = await db
        .updateTable('users')
        .set({ suspended_reason: null })
        .where('id', '=', u.id)
        .returning('updated_at')
        .executeTakeFirstOrThrow();
      expect(after.updated_at.getTime()).toBeGreaterThan(u.updated_at.getTime());
    });
  });

  describe('driver_profiles', () => {
    it('cannot be approved without recording who approved it and when', async () => {
      const u = await db
        .insertInto('users')
        .values({ phone: '+251911000006', role: 'driver', suspended_reason: null })
        .returning('id')
        .executeTakeFirstOrThrow();
      await db
        .insertInto('driver_profiles')
        .values({ user_id: u.id, full_name: 'Test Driver', approved_by: null, approved_at: null })
        .execute();
      await expect(
        db
          .updateTable('driver_profiles')
          .set({ approval_status: 'approved' })
          .where('user_id', '=', u.id)
          .execute(),
      ).rejects.toThrow(/driver_approval_recorded/);
    });
  });

  describe('audit_logs', () => {
    it('is append-only: updates, deletes and truncate are blocked', async () => {
      const row = await db
        .insertInto('audit_logs')
        .values({
          actor_type: 'system',
          actor_id: null,
          action: 'test.created',
          entity_type: 'test',
          entity_id: '1',
          before: null,
          after: JSON.stringify({ ok: true }),
          ip: null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      await expect(
        db.updateTable('audit_logs').set({ action: 'tampered' }).where('id', '=', row.id).execute(),
      ).rejects.toThrow(/append-only/);
      await expect(db.deleteFrom('audit_logs').where('id', '=', row.id).execute()).rejects.toThrow(
        /append-only/,
      );
      await expect(sql`TRUNCATE audit_logs`.execute(db)).rejects.toThrow(/append-only/);
    });
  });

  describe('auth_sessions', () => {
    it('stores each refresh token hash only once', async () => {
      const u = await db
        .insertInto('users')
        .values({ phone: '+251911000007', role: 'passenger', suspended_reason: null })
        .returning('id')
        .executeTakeFirstOrThrow();
      const values = {
        user_id: u.id,
        family_id: '00000000-0000-4000-8000-000000000001',
        refresh_token_hash: 'hash-1',
        expires_at: new Date(Date.now() + 86_400_000),
        revoked_at: null,
        replaced_by: null,
        device_info: null,
      };
      await db.insertInto('auth_sessions').values(values).execute();
      await expect(db.insertInto('auth_sessions').values(values).execute()).rejects.toThrow(
        /duplicate key/,
      );
    });
  });

  it('has PostGIS available', async () => {
    const { rows } = await sql<{ v: string }>`SELECT postgis_version() AS v`.execute(db);
    expect(rows[0]?.v).toMatch(/^3\./);
  });
});
