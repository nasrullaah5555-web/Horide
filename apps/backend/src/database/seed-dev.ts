import { Kysely, sql } from 'kysely';
import { loadConfig } from '../config/env';
import { createDatabase } from './database';
import type { DB, VehicleCategory } from './types';

/**
 * DEVELOPMENT seed data. Never run in production.
 *
 * - The Jijiga service zone is a rough rectangle around the city, NOT a surveyed boundary.
 * - Fares are the illustrative figures from the master prompt (Car 40 + 15/km, Bajaj 20 + 8/km),
 *   NOT validated Jijiga market prices. Minimum fares and rounding are placeholders.
 * Real values are owner decisions (OWNER_ACTION_REGISTER OA-15).
 */

export const DEV_ZONE_NAME = 'Jijiga (DEV approximate)';

// Corners as [longitude, latitude]. The ring must be closed (first point repeated at the end).
const JIJIGA_DEV_RING: [number, number][] = [
  [42.74, 9.3],
  [42.86, 9.3],
  [42.86, 9.4],
  [42.74, 9.4],
  [42.74, 9.3],
];

const DEV_FARES: Record<
  VehicleCategory,
  { base: number; perKm: number; minimum: number; rounding: number }
> = {
  // santim: 4000 = 40 ETB
  car: { base: 4000, perKm: 1500, minimum: 6000, rounding: 500 },
  bajaj: { base: 2000, perKm: 800, minimum: 3000, rounding: 500 },
};

export async function seedDevelopment(db: Kysely<DB>): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const wkt = `POLYGON((${JIJIGA_DEV_RING.map(([lng, lat]) => `${lng} ${lat}`).join(', ')}))`;
    await trx
      .insertInto('service_zones')
      .values({ name: DEV_ZONE_NAME, area: sql`ST_GeogFromText(${wkt})` })
      .onConflict((oc) => oc.column('name').doNothing())
      .execute();

    for (const category of ['car', 'bajaj'] as const) {
      const existing = await trx
        .selectFrom('fare_settings')
        .select('category')
        .where('category', '=', category)
        .executeTakeFirst();
      if (existing) continue;
      const f = DEV_FARES[category];
      const version = await trx
        .insertInto('fare_versions')
        .values({
          category,
          base_fare: f.base,
          per_km: f.perKm,
          minimum_fare: f.minimum,
          rounding_unit: f.rounding,
          note: 'DEV seed — illustrative, not market prices',
          created_by: null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('fare_settings')
        .values({ category, current_version_id: version.id, updated_by: null })
        .execute();
    }

    await trx
      .insertInto('subscription_plans')
      .values({ name: 'DEV Monthly', category: null, price: 50000, duration_days: 30 })
      .onConflict((oc) => oc.column('name').doNothing())
      .execute();
  });
}

async function main(): Promise<void> {
  const config = loadConfig();
  if (config.NODE_ENV === 'production') {
    throw new Error('Refusing to load development seed data in production.');
  }
  const db = createDatabase({ connectionString: config.DATABASE_URL, ssl: config.DATABASE_SSL });
  try {
    await seedDevelopment(db);
    console.log('Development seed loaded (zone, illustrative fares, DEV plan).');
  } finally {
    await db.destroy();
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
