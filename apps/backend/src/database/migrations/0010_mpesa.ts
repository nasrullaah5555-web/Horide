import { Kysely, sql } from 'kysely';

/**
 * Migration 0010 — M-Pesa as a payment method (Nairobi market, ADR-025).
 * Like eBirr it is only RECORDED: the passenger pays the driver directly and the driver types the
 * M-Pesa confirmation code; Musride never receives the money. The reference column, first made for
 * eBirr, now holds either reference.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'mpesa'`.execute(db);
  await sql`
    ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_ebirr_reference_only_for_ebirr;
    ALTER TABLE payments ADD CONSTRAINT payments_reference_not_for_cash
      CHECK (method <> 'cash' OR ebirr_reference IS NULL);
    COMMENT ON COLUMN payments.ebirr_reference IS
      'Transaction reference for eBirr or M-Pesa, as typed by the driver';
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // PostgreSQL can't remove a value from an enum type, so 'mpesa' stays defined; migration 0003's
  // rollback drops the whole type. Rolling back only this migration on a database that has M-Pesa
  // payments would leave values older code doesn't show: restore from a backup instead.
  await sql`
    COMMENT ON COLUMN payments.ebirr_reference IS NULL;
    ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_reference_not_for_cash;
    -- NOT VALID: existing M-Pesa rows keep their reference; new rows follow the old rule.
    ALTER TABLE payments ADD CONSTRAINT payments_ebirr_reference_only_for_ebirr
      CHECK (method = 'ebirr' OR ebirr_reference IS NULL) NOT VALID;
  `.execute(db);
}
