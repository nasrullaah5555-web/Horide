import { Kysely, sql } from 'kysely';

/**
 * Migration 0008 — "Share my trip" links.
 * A passenger can send a link so family can follow the trip without the app. Only a hash of the
 * link's secret is stored, so a database leak doesn't reveal working links. A link shows nothing
 * once the trip has ended or been cancelled; at most 5 links per trip.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE trip_shares (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      trip_id     uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      token_hash  text NOT NULL UNIQUE CHECK (length(token_hash) = 64),
      created_at  timestamptz NOT NULL DEFAULT now(),
      last_viewed_at timestamptz
    );
    CREATE INDEX trip_shares_trip ON trip_shares (trip_id);
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS trip_shares;`.execute(db);
}
