import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { DB } from './types';

export interface DatabaseOptions {
  connectionString: string;
  ssl: boolean;
  maxConnections?: number;
}

/**
 * Creates the Kysely database handle.
 * Kysely builds SQL with bound parameters, so user input is never pasted into SQL text.
 */
export function createDatabase(opts: DatabaseOptions): Kysely<DB> {
  const pool = new Pool({
    connectionString: opts.connectionString,
    ssl: opts.ssl ? { rejectUnauthorized: true } : false,
    max: opts.maxConnections ?? 10,
    // Fail fast instead of hanging forever when the database is unreachable.
    connectionTimeoutMillis: 5_000,
    statement_timeout: 15_000,
  });
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
}
