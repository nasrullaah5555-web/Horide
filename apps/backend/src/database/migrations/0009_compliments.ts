import { Kysely, sql } from 'kysely';

/**
 * Migration 0009 — compliments with ratings (like Uber's compliments).
 * A passenger who gives 4 or 5 stars can add quick compliments; drivers see how often each one
 * was given. A fixed list keeps it simple and stops free text being abused.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE ratings ADD COLUMN compliments text[] NOT NULL DEFAULT '{}'
      CHECK (compliments <@ ARRAY['clean_car', 'safe_driving', 'on_time', 'friendly', 'knows_the_way']::text[])
      CHECK (cardinality(compliments) <= 5)
      CHECK (cardinality(compliments) = 0 OR stars >= 4);
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE ratings DROP COLUMN IF EXISTS compliments;`.execute(db);
}
