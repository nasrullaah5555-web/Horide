import type { AdminRole } from '../../database/types';

/**
 * What each admin role may do. Deny by default: a permission not listed is not granted.
 * Roles combine (an admin with support + finance gets both sets), but no role implies another.
 * Note: super admins manage admin accounts and read the audit log, but do NOT automatically
 * see driver identity documents — that needs the verification role (least privilege).
 */
export const PERMISSIONS = [
  'users.read',
  'users.suspend',
  'drivers.read',
  'drivers.verify',
  'drivers.suspend',
  'documents.read',
  'trips.read',
  'pricing.read',
  'pricing.write',
  'zones.write',
  'subscriptions.read',
  'subscriptions.write',
  'payments.read',
  'payments.resolve',
  'complaints.read',
  'complaints.write',
  'emergencies.read',
  'emergencies.write',
  'notifications.send',
  'reports.read',
  'admins.read',
  'admins.write',
  'audit.read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<AdminRole, readonly Permission[]> = {
  support: [
    'users.read',
    'drivers.read',
    'trips.read',
    'complaints.read',
    'complaints.write',
    'emergencies.read',
    'emergencies.write',
  ],
  verification: ['users.read', 'drivers.read', 'drivers.verify', 'documents.read'],
  finance: [
    'drivers.read',
    'subscriptions.read',
    'subscriptions.write',
    'payments.read',
    'payments.resolve',
    'reports.read',
  ],
  operations: [
    'users.read',
    'users.suspend',
    'drivers.read',
    'drivers.suspend',
    'trips.read',
    'pricing.read',
    'pricing.write',
    'zones.write',
    'notifications.send',
    'reports.read',
  ],
  super: ['admins.read', 'admins.write', 'audit.read', 'reports.read'],
};

export function permissionsFor(roles: readonly AdminRole[]): Set<Permission> {
  return new Set(roles.flatMap((r) => ROLE_PERMISSIONS[r]));
}
