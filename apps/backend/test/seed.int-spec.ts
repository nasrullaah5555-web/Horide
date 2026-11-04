import { Kysely, sql } from 'kysely';
import { DEV_ZONE_NAME, seedDevelopment } from '../src/database/seed-dev';
import type { DB } from '../src/database/types';
import { resetSchema, testDatabase } from './helpers/db';
import { JIJIGA, point } from './helpers/fixtures';

describe('Development seed', () => {
  let db: Kysely<DB>;

  beforeAll(async () => {
    db = testDatabase();
    await resetSchema(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('is idempotent', async () => {
    await seedDevelopment(db);
    await seedDevelopment(db);
    const zones = await db.selectFrom('service_zones').select('id').execute();
    const fares = await db.selectFrom('fare_versions').select('id').execute();
    expect(zones).toHaveLength(1);
    expect(fares).toHaveLength(2);
  });

  it('covers central Jijiga and excludes a point far outside', async () => {
    const inside = await sql<{ ok: boolean }>`
      SELECT ST_Covers(area, ${point(JIJIGA.lat, JIJIGA.lng)}) AS ok
      FROM service_zones WHERE name = ${DEV_ZONE_NAME}`.execute(db);
    const addis = await sql<{ ok: boolean }>`
      SELECT ST_Covers(area, ${point(9.03, 38.74)}) AS ok
      FROM service_zones WHERE name = ${DEV_ZONE_NAME}`.execute(db);
    expect(inside.rows[0]?.ok).toBe(true);
    expect(addis.rows[0]?.ok).toBe(false);
  });

  it('points each category at a fare version of the same category', async () => {
    const rows = await db
      .selectFrom('fare_settings as s')
      .innerJoin('fare_versions as v', 'v.id', 's.current_version_id')
      .select(['s.category as setting', 'v.category as version', 'v.base_fare'])
      .execute();
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.setting).toBe(r.version);
  });
});
