import { loadConfig } from '../config/env';
import { createDatabase } from './database';
import { assertMigrationSuccess, createMigrator } from './migrator';

/**
 * Command-line migration runner.
 *   pnpm migrate        -> apply all pending migrations
 *   pnpm migrate:down   -> undo the most recent migration (development only)
 */
async function main(): Promise<void> {
  const command = process.argv[2] ?? 'latest';
  const config = loadConfig();
  if (command === 'down' && (config.NODE_ENV === 'production' || config.NODE_ENV === 'staging')) {
    throw new Error('Refusing to roll back migrations in production. Restore from backup instead.');
  }
  const db = createDatabase({
    connectionString: config.DATABASE_URL,
    ssl: config.DATABASE_SSL,
    ...(config.DATABASE_CA_CERT ? { caCert: config.DATABASE_CA_CERT } : {}),
  });
  try {
    const migrator = createMigrator(db);
    const result =
      command === 'down' ? await migrator.migrateDown() : await migrator.migrateToLatest();
    for (const r of result.results ?? []) {
      console.log(`${r.status.padEnd(8)} ${r.direction.padEnd(4)} ${r.migrationName}`);
    }
    if (!result.results?.length) console.log('Nothing to do: database is up to date.');
    assertMigrationSuccess(result);
  } finally {
    await db.destroy();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
