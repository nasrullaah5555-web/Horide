import { Kysely, sql } from 'kysely';

/**
 * Migration 0001 — identity, sessions, admins and audit log.
 * Written as plain SQL so it reads exactly like what runs in the database.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE EXTENSION IF NOT EXISTS postgis;
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    CREATE EXTENSION IF NOT EXISTS citext;

    -- Keeps updated_at correct without relying on application code.
    CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TYPE user_role AS ENUM ('passenger', 'driver');
    CREATE TYPE user_status AS ENUM ('active', 'suspended', 'deleted');
    CREATE TYPE approval_status AS ENUM ('pending', 'approved', 'rejected');
    CREATE TYPE admin_role AS ENUM ('support', 'verification', 'finance', 'operations', 'super');
    CREATE TYPE actor_type AS ENUM ('admin', 'user', 'system');
    CREATE TYPE otp_purpose AS ENUM ('login');

    -- Admins are a separate table from passengers/drivers: different login method (password + TOTP),
    -- and a passenger account can never be escalated into an admin account.
    CREATE TABLE admin_users (
      id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email              citext NOT NULL UNIQUE,
      full_name          text NOT NULL CHECK (length(full_name) BETWEEN 1 AND 120),
      password_hash      text NOT NULL,
      totp_secret_enc    text,
      mfa_enabled        boolean NOT NULL DEFAULT false,
      status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
      failed_login_count integer NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
      locked_until       timestamptz,
      last_login_at      timestamptz,
      created_at         timestamptz NOT NULL DEFAULT now(),
      updated_at         timestamptz NOT NULL DEFAULT now()
    );
    CREATE TRIGGER admin_users_updated_at BEFORE UPDATE ON admin_users
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    CREATE TABLE admin_roles (
      admin_user_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
      role          admin_role NOT NULL,
      granted_by    uuid REFERENCES admin_users(id),
      created_at    timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (admin_user_id, role)
    );

    -- Phone numbers are stored in E.164 form and must be Ethiopian (+251, 9 digits after).
    CREATE TABLE users (
      id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      phone            text NOT NULL CHECK (phone ~ '^\\+251[79][0-9]{8}$'),
      role             user_role NOT NULL,
      status           user_status NOT NULL DEFAULT 'active',
      suspended_reason text,
      created_at       timestamptz NOT NULL DEFAULT now(),
      updated_at       timestamptz NOT NULL DEFAULT now(),
      -- One phone can have at most one passenger account and one driver account.
      CONSTRAINT users_phone_role_unique UNIQUE (phone, role),
      CONSTRAINT users_suspension_reason CHECK (status <> 'suspended' OR suspended_reason IS NOT NULL)
    );
    CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    CREATE TABLE passenger_profiles (
      user_id                 uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      full_name               text CHECK (length(full_name) BETWEEN 1 AND 120),
      emergency_contact_phone text CHECK (emergency_contact_phone ~ '^\\+[0-9]{8,15}$'),
      created_at              timestamptz NOT NULL DEFAULT now(),
      updated_at              timestamptz NOT NULL DEFAULT now()
    );
    CREATE TRIGGER passenger_profiles_updated_at BEFORE UPDATE ON passenger_profiles
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    CREATE TABLE driver_profiles (
      user_id         uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      full_name       text CHECK (length(full_name) BETWEEN 1 AND 120),
      approval_status approval_status NOT NULL DEFAULT 'pending',
      approved_by     uuid REFERENCES admin_users(id),
      approved_at     timestamptz,
      rating_avg      numeric(3,2) NOT NULL DEFAULT 0 CHECK (rating_avg BETWEEN 0 AND 5),
      rating_count    integer NOT NULL DEFAULT 0 CHECK (rating_count >= 0),
      created_at      timestamptz NOT NULL DEFAULT now(),
      updated_at      timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT driver_approval_recorded CHECK (
        approval_status <> 'approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)
      )
    );
    CREATE TRIGGER driver_profiles_updated_at BEFORE UPDATE ON driver_profiles
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    -- OTP codes are never stored in plain text: only an HMAC hash.
    CREATE TABLE otp_challenges (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      phone        text NOT NULL,
      purpose      otp_purpose NOT NULL,
      code_hash    text NOT NULL,
      expires_at   timestamptz NOT NULL,
      attempts     integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
      consumed_at  timestamptz,
      ip           inet,
      created_at   timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX otp_challenges_phone_created ON otp_challenges (phone, created_at DESC);
    CREATE INDEX otp_challenges_ip_created ON otp_challenges (ip, created_at DESC);

    -- Refresh tokens are stored hashed. family_id groups rotations so token reuse revokes the family.
    CREATE TABLE auth_sessions (
      id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      family_id          uuid NOT NULL,
      refresh_token_hash text NOT NULL UNIQUE,
      expires_at         timestamptz NOT NULL,
      revoked_at         timestamptz,
      replaced_by        uuid REFERENCES auth_sessions(id),
      device_info        text CHECK (length(device_info) <= 200),
      created_at         timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX auth_sessions_user ON auth_sessions (user_id);
    CREATE INDEX auth_sessions_family ON auth_sessions (family_id);

    CREATE TABLE audit_logs (
      id          bigserial PRIMARY KEY,
      actor_type  actor_type NOT NULL,
      actor_id    uuid,
      action      text NOT NULL CHECK (length(action) BETWEEN 1 AND 100),
      entity_type text NOT NULL CHECK (length(entity_type) BETWEEN 1 AND 60),
      entity_id   text,
      before      jsonb,
      after       jsonb,
      ip          inet,
      created_at  timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX audit_logs_entity ON audit_logs (entity_type, entity_id, created_at DESC);
    CREATE INDEX audit_logs_actor ON audit_logs (actor_type, actor_id, created_at DESC);

    -- The audit log is append-only. This trigger blocks edits and deletes for every database role,
    -- so even a bug or a compromised admin endpoint cannot rewrite history.
    CREATE OR REPLACE FUNCTION audit_logs_block_changes() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'audit_logs is append-only';
    END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs
      FOR EACH ROW EXECUTE FUNCTION audit_logs_block_changes();
    CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
      FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_block_changes();
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Extensions are left installed: other databases objects or Supabase may rely on them.
  await sql`
    DROP TABLE IF EXISTS audit_logs;
    DROP FUNCTION IF EXISTS audit_logs_block_changes();
    DROP TABLE IF EXISTS auth_sessions;
    DROP TABLE IF EXISTS otp_challenges;
    DROP TABLE IF EXISTS driver_profiles;
    DROP TABLE IF EXISTS passenger_profiles;
    DROP TABLE IF EXISTS users;
    DROP TABLE IF EXISTS admin_roles;
    DROP TABLE IF EXISTS admin_users;
    DROP TYPE IF EXISTS otp_purpose;
    DROP TYPE IF EXISTS actor_type;
    DROP TYPE IF EXISTS admin_role;
    DROP TYPE IF EXISTS approval_status;
    DROP TYPE IF EXISTS user_status;
    DROP TYPE IF EXISTS user_role;
    DROP FUNCTION IF EXISTS set_updated_at();
  `.execute(db);
}
