import { Kysely, sql } from 'kysely';
import { MARKETS, type MarketCode } from '../common/market';
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

export const KENYA_TEST_ZONE_NAME = 'Nairobi (TEST only)';

// Test-only area covering Nairobi (CBD, Westlands, Kilimani, Karen, Eastlands, JKIA, Ruaka),
// active when MARKET=KE so the apps can be tried in Nairobi before Jijiga.
const NAIROBI_TEST_RING: [number, number][] = [
  [36.65, -1.45],
  [37.1, -1.45],
  [37.1, -1.1],
  [36.65, -1.1],
  [36.65, -1.45],
];

const DEV_NOTE_ETB = 'DEV seed — illustrative, not market prices';
const DEV_NOTE_KES = 'DEV KES seed — illustrative Nairobi test prices';
const DEV_PLAN_ETB = 'DEV Monthly';
const DEV_PLAN_KES = 'DEV Monthly (KES)';

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
          note: DEV_NOTE_ETB,
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
      .values({ name: DEV_PLAN_ETB, category: null, price: 50000, duration_days: 30 })
      .onConflict((oc) => oc.column('name').doNothing())
      .execute();
  });
}

// Illustrative Nairobi prices in cents (KES × 100), for testing only: NOT researched market
// prices. Car 150 KES + 40 KES/km, tuk-tuk (Bajaj) 70 + 25/km.
const DEV_FARES_KES: typeof DEV_FARES = {
  car: { base: 15000, perKm: 4000, minimum: 25000, rounding: 1000 },
  bajaj: { base: 7000, perKm: 2500, minimum: 12000, rounding: 1000 },
};

/**
 * Makes a development/staging database match its market (ADR-025): the market's service area is
 * active and the other one isn't; the illustrative DEV prices and DEV subscription plan are in
 * the market's currency. Prices an admin has set are never touched: only versions whose note
 * starts with "DEV" are replaced. Nothing is deleted.
 */
export async function syncMarket(db: Kysely<DB>, market: MarketCode): Promise<void> {
  const kenya = market === 'KE';
  await db.transaction().execute(async (trx) => {
    const wkt = `POLYGON((${NAIROBI_TEST_RING.map(([lng, lat]) => `${lng} ${lat}`).join(', ')}))`;
    await trx
      .insertInto('service_zones')
      .values({ name: KENYA_TEST_ZONE_NAME, area: sql`ST_GeogFromText(${wkt})`, active: kenya })
      .onConflict((oc) => oc.column('name').doUpdateSet({ active: kenya }))
      .execute();
    await trx
      .updateTable('service_zones')
      .set({ active: !kenya })
      .where('name', '=', DEV_ZONE_NAME)
      .execute();

    const wanted = kenya ? DEV_NOTE_KES : DEV_NOTE_ETB;
    for (const category of ['car', 'bajaj'] as const) {
      const current = await trx
        .selectFrom('fare_settings as s')
        .innerJoin('fare_versions as v', 'v.id', 's.current_version_id')
        .select('v.note')
        .where('s.category', '=', category)
        .executeTakeFirst();
      if (!current?.note?.startsWith('DEV') || current.note === wanted) continue;
      const f = (kenya ? DEV_FARES_KES : DEV_FARES)[category];
      const version = await trx
        .insertInto('fare_versions')
        .values({
          category,
          base_fare: f.base,
          per_km: f.perKm,
          minimum_fare: f.minimum,
          rounding_unit: f.rounding,
          note: wanted,
          created_by: null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx
        .updateTable('fare_settings')
        .set({ current_version_id: version.id })
        .where('category', '=', category)
        .execute();
    }

    await trx
      .insertInto('subscription_plans')
      .values({
        name: DEV_PLAN_KES,
        category: null,
        price: 150000,
        duration_days: 30,
        active: kenya,
      })
      .onConflict((oc) => oc.column('name').doUpdateSet({ active: kenya }))
      .execute();
    await trx
      .updateTable('subscription_plans')
      .set({ active: !kenya })
      .where('name', '=', DEV_PLAN_ETB)
      .execute();
  });
}

async function main(): Promise<void> {
  const config = loadConfig();
  if (config.NODE_ENV === 'production') {
    throw new Error('Refusing to load development seed data in production.');
  }
  const db = createDatabase({
    connectionString: config.DATABASE_URL,
    ssl: config.DATABASE_SSL,
    ...(config.DATABASE_CA_CERT ? { caCert: config.DATABASE_CA_CERT } : {}),
  });
  try {
    await seedDevelopment(db);
    await syncMarket(db, config.MARKET);
    console.log(
      `Development seed loaded for ${MARKETS[config.MARKET].city} (service area, illustrative ${
        MARKETS[config.MARKET].currency
      } prices, DEV plan).`,
    );
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
