import { Kysely, sql } from 'kysely';

/**
 * Migration 0006 — account deletion and data retention (SECURITY_PLAN §6, store requirements).
 * - A deleted account keeps its id (trips, payments and audit records still point at it) but
 *   loses its phone number, so the person can register again later as a new account.
 *   NULL phones don't collide in the (phone, role) unique constraint.
 * - users.deleted_at records when the deletion happened.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE users ALTER COLUMN phone DROP NOT NULL;
    ALTER TABLE users ADD COLUMN deleted_at timestamptz;
    ALTER TABLE users ADD CONSTRAINT users_phone_unless_deleted
      CHECK ((status = 'deleted') = (phone IS NULL));
    ALTER TABLE users ADD CONSTRAINT users_deleted_at_matches_status
      CHECK ((status = 'deleted') = (deleted_at IS NOT NULL));
    CREATE INDEX trip_locations_recorded ON trip_locations (recorded_at);
    CREATE INDEX otp_challenges_created ON otp_challenges (created_at);
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DROP INDEX IF EXISTS otp_challenges_created;
    DROP INDEX IF EXISTS trip_locations_recorded;
    ALTER TABLE users DROP CONSTRAINT IF EXISTS users_deleted_at_matches_status;
    ALTER TABLE users DROP CONSTRAINT IF EXISTS users_phone_unless_deleted;
    ALTER TABLE users DROP COLUMN IF EXISTS deleted_at;
    -- Deleted accounts' phone numbers are gone for good, so NOT NULL can only come back when
    -- there are none. Otherwise the column stays nullable after a rollback.
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM users WHERE phone IS NULL) THEN
        ALTER TABLE users ALTER COLUMN phone SET NOT NULL;
      END IF;
    END
    $$;
  `.execute(db);
}
