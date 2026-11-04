import { Kysely, sql } from 'kysely';

/**
 * Migration 0002 — vehicles, driver documents, service zones, driver locations,
 * saved places and versioned pricing.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TYPE vehicle_category AS ENUM ('car', 'bajaj');
    CREATE TYPE document_type AS ENUM (
      'national_id', 'driving_licence', 'vehicle_registration', 'permit', 'insurance', 'profile_photo'
    );

    CREATE TABLE vehicles (
      id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      driver_id        uuid NOT NULL REFERENCES driver_profiles(user_id) ON DELETE CASCADE,
      category         vehicle_category NOT NULL,
      make             text NOT NULL CHECK (length(make) BETWEEN 1 AND 40),
      model            text NOT NULL CHECK (length(model) BETWEEN 1 AND 40),
      colour           text NOT NULL CHECK (length(colour) BETWEEN 1 AND 30),
      year             integer CHECK (year BETWEEN 1980 AND 2100),
      -- Plates are stored normalised (upper case, no spaces) so duplicates can't hide behind formatting.
      plate_number     text NOT NULL UNIQUE CHECK (plate_number ~ '^[A-Z0-9-]{3,15}$'),
      approval_status  approval_status NOT NULL DEFAULT 'pending',
      approved_by      uuid REFERENCES admin_users(id),
      approved_at      timestamptz,
      rejection_reason text,
      is_active        boolean NOT NULL DEFAULT true,
      created_at       timestamptz NOT NULL DEFAULT now(),
      updated_at       timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT vehicle_approval_recorded CHECK (
        approval_status <> 'approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)
      ),
      CONSTRAINT vehicle_rejection_reason CHECK (
        approval_status <> 'rejected' OR rejection_reason IS NOT NULL
      )
    );
    CREATE INDEX vehicles_driver ON vehicles (driver_id);
    -- A driver can have at most one approved, active vehicle at a time: the one they drive.
    CREATE UNIQUE INDEX vehicles_one_active_per_driver ON vehicles (driver_id)
      WHERE approval_status = 'approved' AND is_active;
    CREATE TRIGGER vehicles_updated_at BEFORE UPDATE ON vehicles
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    -- Documents live in private storage. Only the storage key is kept here, never a public URL.
    CREATE TABLE driver_documents (
      id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      driver_id        uuid NOT NULL REFERENCES driver_profiles(user_id) ON DELETE CASCADE,
      vehicle_id       uuid REFERENCES vehicles(id) ON DELETE CASCADE,
      type             document_type NOT NULL,
      storage_key      text NOT NULL UNIQUE CHECK (storage_key !~ '^https?://'),
      mime_type        text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'application/pdf')),
      size_bytes       integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 8388608),
      sha256           char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
      status           approval_status NOT NULL DEFAULT 'pending',
      reviewed_by      uuid REFERENCES admin_users(id),
      reviewed_at      timestamptz,
      rejection_reason text,
      expires_on       date,
      created_at       timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT document_review_recorded CHECK (
        status = 'pending' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
      ),
      CONSTRAINT document_rejection_reason CHECK (status <> 'rejected' OR rejection_reason IS NOT NULL),
      CONSTRAINT vehicle_documents_need_vehicle CHECK (
        type NOT IN ('vehicle_registration', 'insurance') OR vehicle_id IS NOT NULL
      )
    );
    CREATE INDEX driver_documents_driver ON driver_documents (driver_id, type);
    CREATE INDEX driver_documents_pending ON driver_documents (created_at) WHERE status = 'pending';

    CREATE TABLE service_zones (
      id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name       text NOT NULL UNIQUE CHECK (length(name) BETWEEN 1 AND 80),
      area       geography(Polygon, 4326) NOT NULL,
      active     boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX service_zones_area ON service_zones USING gist (area);
    CREATE TRIGGER service_zones_updated_at BEFORE UPDATE ON service_zones
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    -- One row per driver with the latest known position. History during trips goes to trip_locations.
    CREATE TABLE driver_locations (
      driver_id   uuid PRIMARY KEY REFERENCES driver_profiles(user_id) ON DELETE CASCADE,
      position    geography(Point, 4326) NOT NULL,
      heading     smallint CHECK (heading BETWEEN 0 AND 359),
      speed_kmh   numeric(5,1) CHECK (speed_kmh >= 0),
      accuracy_m  numeric(7,1) CHECK (accuracy_m >= 0),
      recorded_at timestamptz NOT NULL,
      is_online   boolean NOT NULL DEFAULT false,
      updated_at  timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX driver_locations_position ON driver_locations USING gist (position);
    CREATE INDEX driver_locations_online ON driver_locations (recorded_at) WHERE is_online;
    CREATE TRIGGER driver_locations_updated_at BEFORE UPDATE ON driver_locations
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    CREATE TABLE saved_locations (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      passenger_id uuid NOT NULL REFERENCES passenger_profiles(user_id) ON DELETE CASCADE,
      label        text NOT NULL CHECK (length(label) BETWEEN 1 AND 40),
      position     geography(Point, 4326) NOT NULL,
      address_text text CHECK (length(address_text) <= 200),
      created_at   timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT saved_locations_label_unique UNIQUE (passenger_id, label)
    );

    -- Fare versions are immutable. A price change inserts a new version; old trips keep theirs.
    -- All money is in santim (1 ETB = 100 santim). per_km is santim per kilometre.
    CREATE TABLE fare_versions (
      id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      category             vehicle_category NOT NULL,
      base_fare            bigint NOT NULL CHECK (base_fare >= 0),
      per_km               bigint NOT NULL CHECK (per_km >= 0),
      minimum_fare         bigint NOT NULL CHECK (minimum_fare >= 0),
      rounding_unit        bigint NOT NULL CHECK (rounding_unit > 0),
      waiting_per_min      bigint NOT NULL DEFAULT 0 CHECK (waiting_per_min >= 0),
      free_waiting_minutes integer NOT NULL DEFAULT 3 CHECK (free_waiting_minutes >= 0),
      cancellation_fee     bigint NOT NULL DEFAULT 0 CHECK (cancellation_fee >= 0),
      note                 text CHECK (length(note) <= 200),
      created_by           uuid REFERENCES admin_users(id),
      created_at           timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT fare_versions_id_category UNIQUE (id, category)
    );
    CREATE OR REPLACE FUNCTION fare_versions_immutable() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'fare_versions are immutable; insert a new version instead';
    END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER fare_versions_no_change BEFORE UPDATE OR DELETE ON fare_versions
      FOR EACH ROW EXECUTE FUNCTION fare_versions_immutable();

    -- Points each category at its current version. The composite foreign key guarantees
    -- a car can never be priced with a Bajaj fare version.
    CREATE TABLE fare_settings (
      category           vehicle_category PRIMARY KEY,
      current_version_id uuid NOT NULL,
      updated_by         uuid REFERENCES admin_users(id),
      updated_at         timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT fare_settings_version_fk FOREIGN KEY (current_version_id, category)
        REFERENCES fare_versions (id, category)
    );
    CREATE TRIGGER fare_settings_updated_at BEFORE UPDATE ON fare_settings
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DROP TABLE IF EXISTS fare_settings;
    DROP TABLE IF EXISTS fare_versions;
    DROP FUNCTION IF EXISTS fare_versions_immutable();
    DROP TABLE IF EXISTS saved_locations;
    DROP TABLE IF EXISTS driver_locations;
    DROP TABLE IF EXISTS service_zones;
    DROP TABLE IF EXISTS driver_documents;
    DROP TABLE IF EXISTS vehicles;
    DROP TYPE IF EXISTS document_type;
    DROP TYPE IF EXISTS vehicle_category;
  `.execute(db);
}
