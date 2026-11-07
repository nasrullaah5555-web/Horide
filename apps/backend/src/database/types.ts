import type { ColumnType, Generated } from 'kysely';

/**
 * TypeScript description of the database tables, used by Kysely to type-check queries.
 * Must match the migrations. Tables are added here as their migrations are written.
 */

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type CreatedAt = ColumnType<Date, never, never>;

export type UserRole = 'passenger' | 'driver';
export type UserStatus = 'active' | 'suspended' | 'deleted';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
export type AdminRole = 'support' | 'verification' | 'finance' | 'operations' | 'super';
export type ActorType = 'admin' | 'user' | 'system';
export type OtpPurpose = 'login';

export interface UsersTable {
  id: Generated<string>;
  /** NULL only for deleted accounts (migration 0006). */
  phone: string | null;
  role: UserRole;
  status: Generated<UserStatus>;
  suspended_reason: string | null;
  deleted_at: Generated<Date | null>;
  created_at: CreatedAt;
  updated_at: Generated<Date>;
}

export interface PassengerProfilesTable {
  user_id: string;
  full_name: string | null;
  emergency_contact_phone: string | null;
  created_at: CreatedAt;
  updated_at: Generated<Date>;
}

export interface DriverProfilesTable {
  user_id: string;
  full_name: string | null;
  approval_status: Generated<ApprovalStatus>;
  approved_by: string | null;
  approved_at: Timestamp | null;
  rating_avg: Generated<string>; // numeric is returned as string by pg to avoid precision loss
  rating_count: Generated<number>;
  created_at: CreatedAt;
  updated_at: Generated<Date>;
}

export interface OtpChallengesTable {
  id: Generated<string>;
  phone: string;
  purpose: OtpPurpose;
  code_hash: string;
  expires_at: Timestamp;
  attempts: Generated<number>;
  max_attempts: Generated<number>;
  consumed_at: Timestamp | null;
  ip: string | null;
  created_at: CreatedAt;
}

export interface AuthSessionsTable {
  id: Generated<string>;
  user_id: string;
  family_id: string;
  refresh_token_hash: string;
  expires_at: Timestamp;
  revoked_at: Timestamp | null;
  replaced_by: string | null;
  device_info: string | null;
  created_at: CreatedAt;
}

export interface AdminUsersTable {
  id: Generated<string>;
  email: string;
  full_name: string;
  password_hash: string;
  totp_secret_enc: string | null;
  mfa_enabled: Generated<boolean>;
  status: Generated<'active' | 'disabled'>;
  failed_login_count: Generated<number>;
  locked_until: Timestamp | null;
  last_login_at: Timestamp | null;
  totp_last_step: ColumnType<string | null, number | null | undefined, number | null>;
  created_at: CreatedAt;
  updated_at: Generated<Date>;
}

export interface AdminRolesTable {
  admin_user_id: string;
  role: AdminRole;
  granted_by: string | null;
  created_at: CreatedAt;
}

export interface AuditLogsTable {
  id: Generated<string>; // bigserial, returned as string
  actor_type: ActorType;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before: unknown | null;
  after: unknown | null;
  ip: string | null;
  created_at: CreatedAt;
}

export type VehicleCategory = 'car' | 'bajaj';
export type DocumentType =
  | 'national_id'
  | 'driving_licence'
  | 'vehicle_registration'
  | 'permit'
  | 'insurance'
  | 'profile_photo'
  | 'vehicle_photo';
export type TripStatus =
  | 'requested'
  | 'searching'
  | 'accepted'
  | 'driver_arriving'
  | 'arrived'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'expired';
export type OfferStatus = 'pending' | 'accepted' | 'rejected' | 'expired' | 'cancelled';
export type PaymentMethod = 'cash' | 'ebirr' | 'mpesa';
export type PaymentStatus = 'pending' | 'driver_recorded' | 'confirmed' | 'disputed' | 'resolved';
export type SubscriptionStatus = 'active' | 'expired' | 'cancelled';
export type ComplaintStatus = 'open' | 'in_review' | 'resolved' | 'closed';
export type TripParty = 'passenger' | 'driver' | 'system' | 'admin';

/** PostGIS geography values are read and written through SQL functions; Kysely sees them as opaque. */
type Geography = ColumnType<string, unknown, unknown>;
type Money = ColumnType<string, number | bigint | string, number | bigint | string>; // bigint -> string
/** Money column with a database default: optional on insert. */
type MoneyWithDefault = ColumnType<
  string,
  number | bigint | string | undefined,
  number | bigint | string
>;

export interface VehiclesTable {
  id: Generated<string>;
  driver_id: string;
  category: VehicleCategory;
  make: string;
  model: string;
  colour: string;
  year: number | null;
  plate_number: string;
  approval_status: Generated<ApprovalStatus>;
  approved_by: string | null;
  approved_at: Timestamp | null;
  rejection_reason: string | null;
  is_active: Generated<boolean>;
  created_at: CreatedAt;
  updated_at: Generated<Date>;
}

export interface DriverDocumentsTable {
  id: Generated<string>;
  driver_id: string;
  vehicle_id: string | null;
  type: DocumentType;
  storage_key: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  status: Generated<ApprovalStatus>;
  reviewed_by: string | null;
  reviewed_at: Timestamp | null;
  rejection_reason: string | null;
  expires_on: ColumnType<Date, string | Date, string | Date> | null;
  created_at: CreatedAt;
}

export interface ServiceZonesTable {
  id: Generated<string>;
  name: string;
  area: Geography;
  active: Generated<boolean>;
  created_at: CreatedAt;
  updated_at: Generated<Date>;
}

export interface DriverLocationsTable {
  driver_id: string;
  position: Geography;
  heading: number | null;
  speed_kmh: ColumnType<string | null, number | null, number | null>;
  accuracy_m: ColumnType<string | null, number | null, number | null>;
  recorded_at: Timestamp;
  is_online: Generated<boolean>;
  updated_at: Generated<Date>;
}

export interface SavedLocationsTable {
  id: Generated<string>;
  passenger_id: string;
  label: string;
  position: Geography;
  address_text: string | null;
  created_at: CreatedAt;
}

export interface FareVersionsTable {
  id: Generated<string>;
  category: VehicleCategory;
  base_fare: Money;
  per_km: Money;
  minimum_fare: Money;
  rounding_unit: Money;
  waiting_per_min: MoneyWithDefault;
  free_waiting_minutes: Generated<number>;
  cancellation_fee: MoneyWithDefault;
  note: string | null;
  created_by: string | null;
  created_at: CreatedAt;
}

export interface FareSettingsTable {
  category: VehicleCategory;
  current_version_id: string;
  updated_by: string | null;
  updated_at: Generated<Date>;
}

export interface TripsTable {
  id: Generated<string>;
  passenger_id: string;
  driver_id: string | null;
  vehicle_id: string | null;
  category: VehicleCategory;
  status: Generated<TripStatus>;
  pickup: Geography;
  pickup_text: string | null;
  destination: Geography;
  destination_text: string | null;
  route_distance_m: number;
  route_duration_s: number;
  route_is_estimate: boolean;
  fare_version_id: string;
  quoted_fare: Money;
  locked_fare: Money | null;
  final_fare: Money | null;
  payment_method: PaymentMethod;
  search_wave: Generated<number>;
  requested_at: Generated<Date>;
  accepted_at: Timestamp | null;
  arrived_at: Timestamp | null;
  started_at: Timestamp | null;
  completed_at: Timestamp | null;
  cancelled_at: Timestamp | null;
  cancelled_by: TripParty | null;
  cancel_reason: string | null;
  quote_hash: string | null;
  cancellation_fee: Money | null;
  start_pin: string | null;
  start_pin_failures: Generated<number>;
  updated_at: Generated<Date>;
}

export interface TripSharesTable {
  id: Generated<string>;
  trip_id: string;
  token_hash: string;
  created_at: CreatedAt;
  last_viewed_at: Timestamp | null;
}

export interface TripOffersTable {
  id: Generated<string>;
  trip_id: string;
  driver_id: string;
  wave: number;
  distance_m: number;
  status: Generated<OfferStatus>;
  expires_at: Timestamp;
  responded_at: Timestamp | null;
  created_at: CreatedAt;
}

export interface TripEventsTable {
  id: Generated<string>;
  trip_id: string;
  from_status: TripStatus | null;
  to_status: TripStatus;
  actor_type: TripParty;
  actor_id: string | null;
  data: unknown | null;
  created_at: CreatedAt;
}

export interface TripDestinationChangesTable {
  id: Generated<string>;
  trip_id: string;
  new_destination: Geography;
  destination_text: string | null;
  route_distance_m: number;
  route_duration_s: number;
  fare_version_id: string;
  new_fare: Money;
  status: Generated<'pending' | 'approved' | 'rejected' | 'expired'>;
  expires_at: Timestamp;
  decided_at: Timestamp | null;
  created_at: CreatedAt;
}

export interface TripLocationsTable {
  id: Generated<string>;
  trip_id: string;
  driver_id: string;
  position: Geography;
  recorded_at: Timestamp;
}

export interface PaymentsTable {
  id: Generated<string>;
  trip_id: string;
  method: PaymentMethod;
  amount: Money;
  status: Generated<PaymentStatus>;
  ebirr_reference: string | null;
  driver_recorded_at: Timestamp | null;
  resolved_by: string | null;
  resolution_note: string | null;
  created_at: CreatedAt;
  updated_at: Generated<Date>;
}

export interface PaymentConfirmationsTable {
  id: Generated<string>;
  payment_id: string;
  party: 'passenger' | 'driver';
  outcome: 'confirmed' | 'disputed';
  note: string | null;
  created_at: CreatedAt;
}

export interface SubscriptionPlansTable {
  id: Generated<string>;
  name: string;
  category: VehicleCategory | null;
  price: Money;
  duration_days: number;
  active: Generated<boolean>;
  created_at: CreatedAt;
}

export interface SubscriptionsTable {
  id: Generated<string>;
  driver_id: string;
  plan_id: string;
  status: Generated<SubscriptionStatus>;
  starts_at: Timestamp;
  ends_at: Timestamp;
  created_by: string | null;
  created_at: CreatedAt;
}

export interface SubscriptionPaymentsTable {
  id: Generated<string>;
  subscription_id: string;
  amount: Money;
  method: PaymentMethod;
  reference: string | null;
  received_at: Timestamp;
  recorded_by: string;
  note: string | null;
  created_at: CreatedAt;
}

export interface RatingsTable {
  id: Generated<string>;
  trip_id: string;
  rater_id: string;
  ratee_id: string;
  stars: number;
  comment: string | null;
  compliments: Generated<string[]>;
  created_at: CreatedAt;
}

export interface ComplaintsTable {
  id: Generated<string>;
  trip_id: string | null;
  reporter_id: string;
  against_user_id: string | null;
  category: 'safety' | 'payment' | 'behaviour' | 'vehicle' | 'app' | 'other';
  description: string;
  status: Generated<ComplaintStatus>;
  assigned_to: string | null;
  resolution: string | null;
  created_at: CreatedAt;
  updated_at: Generated<Date>;
  resolved_at: Timestamp | null;
}

export interface EmergencyEventsTable {
  id: Generated<string>;
  trip_id: string | null;
  user_id: string;
  position: Geography | null;
  created_at: CreatedAt;
  handled_by: string | null;
  handled_at: Timestamp | null;
  notes: string | null;
}

export interface NotificationsTable {
  id: Generated<string>;
  user_id: string;
  type: string;
  title: string;
  body: string;
  data: unknown | null;
  read_at: Timestamp | null;
  created_at: CreatedAt;
}

export interface DeviceTokensTable {
  id: Generated<string>;
  user_id: string;
  fcm_token: string;
  platform: 'android' | 'ios';
  last_seen_at: Generated<Date>;
}

export interface AdminSessionsTable {
  id: Generated<string>;
  admin_user_id: string;
  token_hash: string;
  csrf_token_hash: string;
  ip: string | null;
  user_agent: string | null;
  created_at: CreatedAt;
  last_seen_at: Generated<Date>;
  expires_at: Timestamp;
  revoked_at: Timestamp | null;
}

export interface DB {
  users: UsersTable;
  passenger_profiles: PassengerProfilesTable;
  driver_profiles: DriverProfilesTable;
  otp_challenges: OtpChallengesTable;
  auth_sessions: AuthSessionsTable;
  admin_users: AdminUsersTable;
  admin_roles: AdminRolesTable;
  audit_logs: AuditLogsTable;
  vehicles: VehiclesTable;
  driver_documents: DriverDocumentsTable;
  service_zones: ServiceZonesTable;
  driver_locations: DriverLocationsTable;
  saved_locations: SavedLocationsTable;
  fare_versions: FareVersionsTable;
  fare_settings: FareSettingsTable;
  trips: TripsTable;
  trip_offers: TripOffersTable;
  trip_shares: TripSharesTable;
  trip_events: TripEventsTable;
  trip_destination_changes: TripDestinationChangesTable;
  trip_locations: TripLocationsTable;
  payments: PaymentsTable;
  payment_confirmations: PaymentConfirmationsTable;
  subscription_plans: SubscriptionPlansTable;
  subscriptions: SubscriptionsTable;
  subscription_payments: SubscriptionPaymentsTable;
  ratings: RatingsTable;
  complaints: ComplaintsTable;
  emergency_events: EmergencyEventsTable;
  notifications: NotificationsTable;
  device_tokens: DeviceTokensTable;
  admin_sessions: AdminSessionsTable;
}
