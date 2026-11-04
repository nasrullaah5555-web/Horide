# Horide — Database Design

PostgreSQL 16 + PostGIS. Extensions: `postgis`, `pgcrypto` (UUIDs), `citext` (admin emails).
Conventions: `uuid` primary keys (`gen_random_uuid()`), `created_at`/`updated_at timestamptz`, money in `bigint` santim, geometry as `geography(Point,4326)`, enums as Postgres enums.

## Enums

- `user_role`: passenger, driver
- `vehicle_category`: car, bajaj
- `approval_status`: pending, approved, rejected
- `document_type`: national_id, driving_licence, vehicle_registration, permit, insurance, profile_photo
- `trip_status`: requested, searching, accepted, driver_arriving, arrived, in_progress, completed, cancelled, expired
- `offer_status`: pending, accepted, rejected, expired, cancelled
- `payment_method`: cash, ebirr
- `payment_status`: pending, driver_recorded, confirmed, disputed, resolved
- `subscription_status`: active, expired, cancelled
- `complaint_status`: open, in_review, resolved, closed

## Identity

**users** — id, phone (E.164, unique), role, status (active/suspended/deleted), suspended_reason, created_at, updated_at.
Unique (phone, role): one phone may hold one passenger and one driver account.

**passenger_profiles** — user_id PK/FK, full_name, emergency_contact_phone.

**driver_profiles** — user_id PK/FK, full_name, approval_status, approved_by (admin FK), approved_at, rating_avg numeric(3,2), rating_count.

**otp_challenges** — id, phone, purpose, code_hash, expires_at, attempts, max_attempts, consumed_at, ip, created_at. Index (phone, created_at).

**auth_sessions** — id, user_id FK, family_id, refresh_token_hash (unique), expires_at, revoked_at, replaced_by, device_info, created_at. Reuse of a revoked token revokes the family.

**admin_users** — id, email citext unique, password_hash (argon2id), totp_secret_enc, mfa_enabled, status, last_login_at.
**admin_roles** — admin_user_id FK, role (support/verification/finance/operations/super), PK(both).

**audit_logs** — id bigserial, actor_type (admin/user/system), actor_id, action, entity_type, entity_id, before jsonb, after jsonb, ip, created_at. Append-only: application DB role has INSERT/SELECT only.

## Fleet and geography

**vehicles** — id, driver_id FK, category, make, model, colour, year, plate_number (unique, normalised upper-case), approval_status, approved_by, approved_at. Partial unique: one approved active vehicle per driver.

**driver_documents** — id, driver_id FK, type, storage_key (never a public URL), mime_type, size_bytes, sha256, status (approval_status), reviewed_by, reviewed_at, rejection_reason, expires_on.

**service_zones** — id, name, area geography(Polygon,4326), active. GiST index.

**driver_locations** — driver_id PK/FK, position geography(Point), heading, speed_kmh, accuracy_m, recorded_at, is_online. GiST index on position. Single current row per driver (upsert).

**saved_locations** — id, passenger_id FK, label, position, address_text. Max 10 per passenger (enforced in app layer).

## Pricing

**fare_settings** — category PK, current_version_id FK.
**fare_versions** — id, category, base_fare, per_km, minimum_fare, rounding_unit, waiting_per_min, cancellation_fee (all santim except per_km santim/km), effective_from, created_by, created_at. Immutable: never updated, only inserted.

## Trips

**trips** — id, passenger_id, driver_id (nullable), vehicle_id, category, status, pickup geography, pickup_text, destination geography, destination_text, route_distance_m, route_duration_s, fare_version_id, quoted_fare, locked_fare, final_fare, payment_method, requested_at, accepted_at, arrived_at, started_at, completed_at, cancelled_at, cancelled_by, cancel_reason, version int.
Indexes: (status), (passenger_id, requested_at desc), (driver_id, requested_at desc).
Partial unique: `driver_id` where status in (accepted, driver_arriving, arrived, in_progress); `passenger_id` where status in (requested, searching, accepted, driver_arriving, arrived, in_progress).

**trip_offers** — id, trip_id, driver_id, wave, status, expires_at, responded_at. Unique (trip_id, driver_id).

**trip_events** — id bigserial, trip_id, from_status, to_status, actor_type, actor_id, data jsonb, created_at.

**trip_destination_changes** — id, trip_id, new_destination, new_quoted_fare, fare_version_id, status (pending/approved/rejected), created_at.

**trip_locations** — id bigserial, trip_id, driver_id, position, recorded_at. Index (trip_id, recorded_at). Retention: 180 days then aggregated (privacy).

## Payments and subscriptions

**payments** — id, trip_id unique FK, method, amount, status, ebirr_reference, driver_recorded_at, created_at.
**payment_confirmations** — id, payment_id, party (driver/passenger), outcome (confirmed/disputed), note, created_at. Unique (payment_id, party).

**subscription_plans** — id, name, category (nullable = all), price, duration_days, active.
**subscriptions** — id, driver_id, plan_id, status, starts_at, ends_at, created_by. Exclusion constraint: no overlapping active periods per driver.
**subscription_payments** — id, subscription_id, amount, method, reference, received_at, recorded_by (finance admin), note.

## Feedback and safety

**ratings** — id, trip_id, rater_id, ratee_id, stars 1–5, comment. Unique (trip_id, rater_id).
**complaints** — id, trip_id nullable, reporter_id, against_user_id nullable, category, description, status, assigned_to, resolution, timestamps.
**emergency_events** — id, trip_id nullable, user_id, position, created_at, handled_by, handled_at, notes.
**notifications** — id, user_id, type, title, body, data jsonb, read_at, created_at.
**device_tokens** — id, user_id, fcm_token unique, platform, last_seen_at.

## Transactions

Mandatory transactions: trip acceptance (+ offer updates + event), every status transition (+ event), admin actions (+ audit log), subscription payment (+ subscription row), destination change approval.

## Backup and recovery

- Supabase daily backups (paid plan) + weekly logical `pg_dump`, encrypted with age/GPG, stored in a separate account.
- Restore drill before pilot: restore to staging, run smoke tests, record time taken in TEST_REPORT.md.
- Target: RPO 24 h (pilot), RTO 4 h.
