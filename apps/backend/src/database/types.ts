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
  phone: string;
  role: UserRole;
  status: Generated<UserStatus>;
  suspended_reason: string | null;
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

export interface DB {
  users: UsersTable;
  passenger_profiles: PassengerProfilesTable;
  driver_profiles: DriverProfilesTable;
  otp_challenges: OtpChallengesTable;
  auth_sessions: AuthSessionsTable;
  admin_users: AdminUsersTable;
  admin_roles: AdminRolesTable;
  audit_logs: AuditLogsTable;
}
