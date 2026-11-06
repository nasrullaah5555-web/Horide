import { Kysely, Migration, MigrationResultSet, Migrator } from 'kysely';
import * as m0001 from './migrations/0001_identity';
import * as m0002 from './migrations/0002_fleet_geo_pricing';
import * as m0003 from './migrations/0003_trips_payments_subscriptions';
import * as m0004 from './migrations/0004_admin_sessions';
import * as m0005 from './migrations/0005_trip_dispatch';
import * as m0006 from './migrations/0006_account_deletion';
import * as m0007 from './migrations/0007_ride_pin';

/**
 * The list of migrations, in order. Listed explicitly (instead of read from disk) so the
 * same code works from TypeScript source and from compiled JavaScript.
 * Never edit a migration that has run in production — add a new one instead.
 */
export const migrations: Record<string, Migration> = {
  '0001_identity': m0001,
  '0002_fleet_geo_pricing': m0002,
  '0003_trips_payments_subscriptions': m0003,
  '0004_admin_sessions': m0004,
  '0005_trip_dispatch': m0005,
  '0006_account_deletion': m0006,
  '0007_ride_pin': m0007,
};

// Migrations work on any schema, so the database type is intentionally untyped here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createMigrator(db: Kysely<any>): Migrator {
  return new Migrator({
    db,
    provider: { getMigrations: async () => migrations },
  });
}

/** Throws if any migration failed, so callers (CLI, tests, deploy) never continue on a broken schema. */
export function assertMigrationSuccess(result: MigrationResultSet): void {
  if (result.error) {
    const failed = result.results?.find((r) => r.status === 'Error');
    throw new Error(
      `Migration ${failed?.migrationName ?? '(unknown)'} failed: ${String(result.error)}`,
    );
  }
}
