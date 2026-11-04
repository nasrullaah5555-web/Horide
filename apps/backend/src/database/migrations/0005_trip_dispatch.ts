import { Kysely, sql } from 'kysely';

/**
 * Migration 0005 — dispatch support.
 * - trips.quote_hash: each signed quote can create at most one trip (idempotent booking over
 *   weak connections, and a quote can't be replayed to book a second ride).
 * - trips.cancellation_fee: recorded at cancellation time from the trip's fare version.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE trips ADD COLUMN quote_hash text;
    CREATE UNIQUE INDEX trips_quote_hash_unique ON trips (quote_hash) WHERE quote_hash IS NOT NULL;
    ALTER TABLE trips ADD COLUMN cancellation_fee bigint CHECK (cancellation_fee >= 0);
    CREATE INDEX trip_offers_trip_pending ON trip_offers (trip_id) WHERE status = 'pending';
    CREATE INDEX trips_searching ON trips (requested_at) WHERE status = 'searching';
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DROP INDEX IF EXISTS trips_searching;
    DROP INDEX IF EXISTS trip_offers_trip_pending;
    ALTER TABLE trips DROP COLUMN IF EXISTS cancellation_fee;
    DROP INDEX IF EXISTS trips_quote_hash_unique;
    ALTER TABLE trips DROP COLUMN IF EXISTS quote_hash;
  `.execute(db);
}
