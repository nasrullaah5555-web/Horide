import { Kysely } from 'kysely';
import { loadConfig } from '../../src/config/env';
import { createDatabase } from '../../src/database/database';
import { assertMigrationSuccess, createMigrator } from '../../src/database/migrator';
import type { DB } from '../../src/database/types';

export function testDatabase(): Kysely<DB> {
  const config = loadConfig();
  if (!/musride_test|_test\b/.test(config.DATABASE_URL)) {
    // Safety net: tests drop tables, so refuse to run against anything that isn't a test database.
    throw new Error('Tests must use a database whose name ends with _test');
  }
  return createDatabase({ connectionString: config.DATABASE_URL, ssl: false, maxConnections: 5 });
}

/** Rolls the schema all the way down and back up, giving each test file a clean database. */
export async function resetSchema(db: Kysely<DB>): Promise<void> {
  const migrator = createMigrator(db);
  let result;
  do {
    result = await migrator.migrateDown();
    assertMigrationSuccess(result);
  } while (result.results && result.results.length > 0);
  assertMigrationSuccess(await migrator.migrateToLatest());
}
