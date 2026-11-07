import { Kysely, sql } from 'kysely';

/**
 * Migration 0011 — a photo of the vehicle (ADR-027). Like the driver's profile photo it is a
 * private document that Musride staff approve; once approved, a small copy is shown to the
 * passenger of a trip with that vehicle so they can recognise the car.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TYPE document_type ADD VALUE IF NOT EXISTS 'vehicle_photo'`.execute(db);
}

export async function down(_db: Kysely<unknown>): Promise<void> {
  // PostgreSQL can't remove a value from an enum type; migration 0002's rollback drops the whole
  // type. Vehicle photos uploaded after this migration stay in the table; restore from a backup
  // if they must go.
}
