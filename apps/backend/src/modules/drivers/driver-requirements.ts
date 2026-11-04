import type { DocumentType } from '../../database/types';

/**
 * Documents a driver must have approved before the driver can be approved.
 * Insurance and permits are not required by default because the legal requirements for Jijiga
 * are not confirmed yet (owner action OA-16). Change this list once they are.
 */
export const REQUIRED_DRIVER_DOCUMENTS: readonly DocumentType[] = [
  'profile_photo',
  'national_id',
  'driving_licence',
  'vehicle_registration',
];

/** Documents that describe a vehicle and must be linked to one. */
export const VEHICLE_DOCUMENTS: readonly DocumentType[] = ['vehicle_registration', 'insurance'];

/** Plates are compared in one canonical form: upper case, no spaces or dots. */
export function normalizePlate(input: string): string {
  return input.toUpperCase().replace(/[\s.]/g, '');
}
