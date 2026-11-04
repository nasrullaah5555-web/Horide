import { Kysely, sql } from 'kysely';

/**
 * Migration 0003 — trips and offers, ride payment records, driver subscriptions,
 * ratings, complaints, emergencies and notifications.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    -- Needed for the "no overlapping subscriptions" exclusion constraint.
    CREATE EXTENSION IF NOT EXISTS btree_gist;

    CREATE TYPE trip_status AS ENUM (
      'requested', 'searching', 'accepted', 'driver_arriving', 'arrived',
      'in_progress', 'completed', 'cancelled', 'expired'
    );
    CREATE TYPE offer_status AS ENUM ('pending', 'accepted', 'rejected', 'expired', 'cancelled');
    CREATE TYPE payment_method AS ENUM ('cash', 'ebirr');
    CREATE TYPE payment_status AS ENUM ('pending', 'driver_recorded', 'confirmed', 'disputed', 'resolved');
    CREATE TYPE subscription_status AS ENUM ('active', 'expired', 'cancelled');
    CREATE TYPE complaint_status AS ENUM ('open', 'in_review', 'resolved', 'closed');
    CREATE TYPE trip_party AS ENUM ('passenger', 'driver', 'system', 'admin');

    CREATE TABLE trips (
      id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      passenger_id       uuid NOT NULL REFERENCES passenger_profiles(user_id),
      driver_id          uuid REFERENCES driver_profiles(user_id),
      vehicle_id         uuid REFERENCES vehicles(id),
      category           vehicle_category NOT NULL,
      status             trip_status NOT NULL DEFAULT 'requested',
      pickup             geography(Point, 4326) NOT NULL,
      pickup_text        text CHECK (length(pickup_text) <= 200),
      destination        geography(Point, 4326) NOT NULL,
      destination_text   text CHECK (length(destination_text) <= 200),
      route_distance_m   integer NOT NULL CHECK (route_distance_m >= 0),
      route_duration_s   integer NOT NULL CHECK (route_duration_s >= 0),
      route_is_estimate  boolean NOT NULL,
      fare_version_id    uuid NOT NULL,
      quoted_fare        bigint NOT NULL CHECK (quoted_fare > 0),
      locked_fare        bigint CHECK (locked_fare > 0),
      final_fare         bigint CHECK (final_fare >= 0),
      payment_method     payment_method NOT NULL,
      search_wave        integer NOT NULL DEFAULT 0 CHECK (search_wave >= 0),
      requested_at       timestamptz NOT NULL DEFAULT now(),
      accepted_at        timestamptz,
      arrived_at         timestamptz,
      started_at         timestamptz,
      completed_at       timestamptz,
      cancelled_at       timestamptz,
      cancelled_by       trip_party,
      cancel_reason      text CHECK (length(cancel_reason) <= 300),
      updated_at         timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT trips_fare_version_fk FOREIGN KEY (fare_version_id, category)
        REFERENCES fare_versions (id, category),
      CONSTRAINT trips_driver_required CHECK (
        status IN ('requested', 'searching', 'expired', 'cancelled') OR driver_id IS NOT NULL
      ),
      CONSTRAINT trips_fare_locked_with_driver CHECK (
        driver_id IS NULL OR (locked_fare IS NOT NULL AND vehicle_id IS NOT NULL AND accepted_at IS NOT NULL)
      ),
      CONSTRAINT trips_completed_fields CHECK (
        status <> 'completed' OR (final_fare IS NOT NULL AND completed_at IS NOT NULL AND started_at IS NOT NULL)
      ),
      CONSTRAINT trips_cancelled_fields CHECK (
        status <> 'cancelled' OR (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL)
      )
    );
    CREATE INDEX trips_status ON trips (status);
    CREATE INDEX trips_passenger_history ON trips (passenger_id, requested_at DESC);
    CREATE INDEX trips_driver_history ON trips (driver_id, requested_at DESC);
    -- A driver can be on at most one active trip; a passenger can have at most one open trip.
    CREATE UNIQUE INDEX trips_one_active_per_driver ON trips (driver_id)
      WHERE status IN ('accepted', 'driver_arriving', 'arrived', 'in_progress');
    CREATE UNIQUE INDEX trips_one_open_per_passenger ON trips (passenger_id)
      WHERE status IN ('requested', 'searching', 'accepted', 'driver_arriving', 'arrived', 'in_progress');
    CREATE TRIGGER trips_updated_at BEFORE UPDATE ON trips
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    CREATE TABLE trip_offers (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      trip_id      uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      driver_id    uuid NOT NULL REFERENCES driver_profiles(user_id),
      wave         integer NOT NULL CHECK (wave >= 1),
      distance_m   integer NOT NULL CHECK (distance_m >= 0),
      status       offer_status NOT NULL DEFAULT 'pending',
      expires_at   timestamptz NOT NULL,
      responded_at timestamptz,
      created_at   timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT trip_offers_once_per_driver UNIQUE (trip_id, driver_id)
    );
    CREATE INDEX trip_offers_driver_pending ON trip_offers (driver_id) WHERE status = 'pending';
    CREATE INDEX trip_offers_expiry ON trip_offers (expires_at) WHERE status = 'pending';

    CREATE TABLE trip_events (
      id          bigserial PRIMARY KEY,
      trip_id     uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      from_status trip_status,
      to_status   trip_status NOT NULL,
      actor_type  trip_party NOT NULL,
      actor_id    uuid,
      data        jsonb,
      created_at  timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX trip_events_trip ON trip_events (trip_id, id);

    CREATE TABLE trip_destination_changes (
      id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      trip_id          uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      new_destination  geography(Point, 4326) NOT NULL,
      destination_text text CHECK (length(destination_text) <= 200),
      route_distance_m integer NOT NULL CHECK (route_distance_m >= 0),
      route_duration_s integer NOT NULL CHECK (route_duration_s >= 0),
      fare_version_id  uuid NOT NULL REFERENCES fare_versions(id),
      new_fare         bigint NOT NULL CHECK (new_fare > 0),
      status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
      expires_at       timestamptz NOT NULL,
      decided_at       timestamptz,
      created_at       timestamptz NOT NULL DEFAULT now()
    );
    -- Only one pending destination change per trip at a time.
    CREATE UNIQUE INDEX trip_destination_changes_one_pending ON trip_destination_changes (trip_id)
      WHERE status = 'pending';

    CREATE TABLE trip_locations (
      id          bigserial PRIMARY KEY,
      trip_id     uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      driver_id   uuid NOT NULL REFERENCES driver_profiles(user_id),
      position    geography(Point, 4326) NOT NULL,
      recorded_at timestamptz NOT NULL
    );
    CREATE INDEX trip_locations_trip ON trip_locations (trip_id, recorded_at);

    -- Ride payment RECORDS. Horide never holds this money; it records what driver and passenger report.
    CREATE TABLE payments (
      id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      trip_id            uuid NOT NULL UNIQUE REFERENCES trips(id),
      method             payment_method NOT NULL,
      amount             bigint NOT NULL CHECK (amount >= 0),
      status             payment_status NOT NULL DEFAULT 'pending',
      ebirr_reference    text CHECK (ebirr_reference ~ '^[A-Za-z0-9-]{4,40}$'),
      driver_recorded_at timestamptz,
      resolved_by        uuid REFERENCES admin_users(id),
      resolution_note    text CHECK (length(resolution_note) <= 500),
      created_at         timestamptz NOT NULL DEFAULT now(),
      updated_at         timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT payments_ebirr_reference_only_for_ebirr CHECK (method = 'ebirr' OR ebirr_reference IS NULL),
      CONSTRAINT payments_resolution_recorded CHECK (status <> 'resolved' OR resolved_by IS NOT NULL)
    );
    CREATE INDEX payments_disputed ON payments (created_at) WHERE status = 'disputed';
    CREATE TRIGGER payments_updated_at BEFORE UPDATE ON payments
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    CREATE TABLE payment_confirmations (
      id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
      party      trip_party NOT NULL CHECK (party IN ('passenger', 'driver')),
      outcome    text NOT NULL CHECK (outcome IN ('confirmed', 'disputed')),
      note       text CHECK (length(note) <= 500),
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT payment_confirmations_once_per_party UNIQUE (payment_id, party)
    );

    CREATE TABLE subscription_plans (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name          text NOT NULL UNIQUE CHECK (length(name) BETWEEN 1 AND 60),
      category      vehicle_category, -- NULL = valid for any category
      price         bigint NOT NULL CHECK (price >= 0),
      duration_days integer NOT NULL CHECK (duration_days BETWEEN 1 AND 366),
      active        boolean NOT NULL DEFAULT true,
      created_at    timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE subscriptions (
      id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      driver_id  uuid NOT NULL REFERENCES driver_profiles(user_id),
      plan_id    uuid NOT NULL REFERENCES subscription_plans(id),
      status     subscription_status NOT NULL DEFAULT 'active',
      starts_at  timestamptz NOT NULL,
      ends_at    timestamptz NOT NULL,
      created_by uuid REFERENCES admin_users(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT subscriptions_period_valid CHECK (ends_at > starts_at),
      -- Two active subscriptions for the same driver may never cover the same moment.
      CONSTRAINT subscriptions_no_overlap EXCLUDE USING gist (
        driver_id WITH =, tstzrange(starts_at, ends_at) WITH &&
      ) WHERE (status = 'active')
    );
    CREATE INDEX subscriptions_driver ON subscriptions (driver_id, ends_at DESC);

    CREATE TABLE subscription_payments (
      id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      subscription_id uuid NOT NULL REFERENCES subscriptions(id),
      amount          bigint NOT NULL CHECK (amount >= 0),
      method          payment_method NOT NULL,
      reference       text CHECK (length(reference) <= 60),
      received_at     timestamptz NOT NULL,
      recorded_by     uuid NOT NULL REFERENCES admin_users(id),
      note            text CHECK (length(note) <= 300),
      created_at      timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX subscription_payments_subscription ON subscription_payments (subscription_id);

    CREATE TABLE ratings (
      id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      trip_id    uuid NOT NULL REFERENCES trips(id),
      rater_id   uuid NOT NULL REFERENCES users(id),
      ratee_id   uuid NOT NULL REFERENCES users(id),
      stars      smallint NOT NULL CHECK (stars BETWEEN 1 AND 5),
      comment    text CHECK (length(comment) <= 500),
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT ratings_once_per_trip_rater UNIQUE (trip_id, rater_id),
      CONSTRAINT ratings_not_self CHECK (rater_id <> ratee_id)
    );
    CREATE INDEX ratings_ratee ON ratings (ratee_id);

    CREATE TABLE complaints (
      id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      trip_id         uuid REFERENCES trips(id),
      reporter_id     uuid NOT NULL REFERENCES users(id),
      against_user_id uuid REFERENCES users(id),
      category        text NOT NULL CHECK (category IN ('safety', 'payment', 'behaviour', 'vehicle', 'app', 'other')),
      description     text NOT NULL CHECK (length(description) BETWEEN 1 AND 2000),
      status          complaint_status NOT NULL DEFAULT 'open',
      assigned_to     uuid REFERENCES admin_users(id),
      resolution      text CHECK (length(resolution) <= 2000),
      created_at      timestamptz NOT NULL DEFAULT now(),
      updated_at      timestamptz NOT NULL DEFAULT now(),
      resolved_at     timestamptz,
      CONSTRAINT complaints_resolution_recorded CHECK (
        status NOT IN ('resolved', 'closed') OR (resolution IS NOT NULL AND resolved_at IS NOT NULL)
      )
    );
    CREATE INDEX complaints_open ON complaints (created_at) WHERE status IN ('open', 'in_review');
    CREATE TRIGGER complaints_updated_at BEFORE UPDATE ON complaints
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    CREATE TABLE emergency_events (
      id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      trip_id    uuid REFERENCES trips(id),
      user_id    uuid NOT NULL REFERENCES users(id),
      position   geography(Point, 4326),
      created_at timestamptz NOT NULL DEFAULT now(),
      handled_by uuid REFERENCES admin_users(id),
      handled_at timestamptz,
      notes      text CHECK (length(notes) <= 2000)
    );
    CREATE INDEX emergency_events_unhandled ON emergency_events (created_at) WHERE handled_at IS NULL;

    CREATE TABLE notifications (
      id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type       text NOT NULL CHECK (length(type) BETWEEN 1 AND 60),
      title      text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
      body       text NOT NULL CHECK (length(body) BETWEEN 1 AND 500),
      data       jsonb,
      read_at    timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX notifications_user ON notifications (user_id, created_at DESC);

    CREATE TABLE device_tokens (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      fcm_token    text NOT NULL UNIQUE CHECK (length(fcm_token) BETWEEN 10 AND 4096),
      platform     text NOT NULL CHECK (platform IN ('android', 'ios')),
      last_seen_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX device_tokens_user ON device_tokens (user_id);
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DROP TABLE IF EXISTS device_tokens;
    DROP TABLE IF EXISTS notifications;
    DROP TABLE IF EXISTS emergency_events;
    DROP TABLE IF EXISTS complaints;
    DROP TABLE IF EXISTS ratings;
    DROP TABLE IF EXISTS subscription_payments;
    DROP TABLE IF EXISTS subscriptions;
    DROP TABLE IF EXISTS subscription_plans;
    DROP TABLE IF EXISTS payment_confirmations;
    DROP TABLE IF EXISTS payments;
    DROP TABLE IF EXISTS trip_locations;
    DROP TABLE IF EXISTS trip_destination_changes;
    DROP TABLE IF EXISTS trip_events;
    DROP TABLE IF EXISTS trip_offers;
    DROP TABLE IF EXISTS trips;
    DROP TYPE IF EXISTS trip_party;
    DROP TYPE IF EXISTS complaint_status;
    DROP TYPE IF EXISTS subscription_status;
    DROP TYPE IF EXISTS payment_status;
    DROP TYPE IF EXISTS payment_method;
    DROP TYPE IF EXISTS offer_status;
    DROP TYPE IF EXISTS trip_status;
  `.execute(db);
}
