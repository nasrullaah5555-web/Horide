import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { DB } from './types';

export interface DatabaseOptions {
  connectionString: string;
  ssl: boolean;
  /** PEM (or base64 of PEM) of the CA that signed the database certificate. */
  caCert?: string;
  maxConnections?: number;
}

/**
 * Creates the Kysely database handle.
 * Kysely builds SQL with bound parameters, so user input is never pasted into SQL text.
 */
export function createDatabase(opts: DatabaseOptions): Kysely<DB> {
  const pool = new Pool({
    connectionString: opts.connectionString,
    ssl: opts.ssl
      ? { rejectUnauthorized: true, ...(opts.caCert ? { ca: pem(opts.caCert) } : {}) }
      : false,
    max: opts.maxConnections ?? 10,
    // Fail fast instead of hanging forever when the database is unreachable.
    connectionTimeoutMillis: 5_000,
    statement_timeout: 15_000,
  });
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
}

/** Accepts the certificate as PEM text or as base64 of the PEM (easier to paste into hosting settings). */
function pem(value: string): string {
  return value.includes('BEGIN CERTIFICATE')
    ? value
    : Buffer.from(value, 'base64').toString('utf8');
}
