import { Kysely, sql } from 'kysely';

/**
 * Migration 0007 — ride PIN (like Uber's "Verify your ride").
 * When a driver accepts, the trip gets a random 4-digit PIN that only the passenger sees. The
 * driver must enter it to start the trip, which proves the right passenger is in the right car.
 * The PIN is removed as soon as the trip starts, ends or is cancelled. Wrong attempts are counted
 * and limited, so the PIN can't be guessed.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE trips ADD COLUMN start_pin text CHECK (start_pin ~ '^[0-9]{4}$');
    ALTER TABLE trips ADD COLUMN start_pin_failures smallint NOT NULL DEFAULT 0
      CHECK (start_pin_failures >= 0);
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE trips DROP COLUMN IF EXISTS start_pin_failures;
    ALTER TABLE trips DROP COLUMN IF EXISTS start_pin;
  `.execute(db);
}
