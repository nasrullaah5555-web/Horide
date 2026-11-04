import { Kysely, sql } from 'kysely';

/** Migration 0004 — admin sessions (cookie-based) and TOTP replay protection. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    -- The last accepted TOTP time-step. A code from the same or an earlier step is rejected,
    -- so a code seen over someone's shoulder can't be reused within its 30-second window.
    ALTER TABLE admin_users ADD COLUMN totp_last_step bigint;

    CREATE TABLE admin_sessions (
      id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      admin_user_id   uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
      token_hash      text NOT NULL UNIQUE,
      csrf_token_hash text NOT NULL,
      ip              inet,
      user_agent      text CHECK (length(user_agent) <= 300),
      created_at      timestamptz NOT NULL DEFAULT now(),
      last_seen_at    timestamptz NOT NULL DEFAULT now(),
      expires_at      timestamptz NOT NULL,
      revoked_at      timestamptz
    );
    CREATE INDEX admin_sessions_admin ON admin_sessions (admin_user_id);
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DROP TABLE IF EXISTS admin_sessions;
    ALTER TABLE admin_users DROP COLUMN IF EXISTS totp_last_step;
  `.execute(db);
}
