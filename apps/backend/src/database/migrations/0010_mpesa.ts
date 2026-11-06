import { Kysely, sql } from 'kysely';

/**
 * Migration 0010 — M-Pesa as a payment method (Nairobi market, ADR-025).
 * Like eBirr it is only RECORDED: the passenger pays the driver directly and the driver types the
 * M-Pesa confirmation code; Musride never receives the money. The reference column, first made for
 * eBirr, now holds either reference.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'mpesa'`.execute(db);
  await sql`COMMENT ON COLUMN payments.ebirr_reference IS
    'Transaction reference for eBirr or M-Pesa, as typed by the driver'`.execute(db);
}

export async function down(): Promise<void> {
  // PostgreSQL can't remove an enum value. Rows using 'mpesa' would also have to go first.
  throw new Error('0010_mpesa cannot be rolled back; restore from a backup instead.');
}
