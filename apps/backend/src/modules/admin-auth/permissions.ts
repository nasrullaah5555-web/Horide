import type { AdminRole } from '../../database/types';

/**
 * What each admin role may do. Deny by default: a permission not listed is not granted.
 * Roles combine (an admin with support + finance gets both sets), but no role implies another.
 * Note: the super role itself manages staff and reads the audit log; it does not include driver
 * documents or money. A super admin who needs those adds the role to themselves (ADR-020).
 */
export const PERMISSIONS = [
  'users.read',
  'users.suspend',
  'drivers.read',
  'drivers.verify',
  'drivers.suspend',
  'documents.read',
  'trips.read',
  'trips.cancel',
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
    'trips.cancel',
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
    'trips.cancel',
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
