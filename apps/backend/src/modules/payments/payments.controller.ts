import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { Kysely, sql, Transaction } from 'kysely';
import { z } from 'zod';
import { AppError } from '../../common/errors';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { DATABASE } from '../../database/database.module';
import type { DB, PaymentStatus } from '../../database/types';
import type { AdminPrincipal } from '../admin-auth/admin-auth.service';
import { AdminGuard, CurrentAdmin, RequirePermission } from '../admin-auth/admin.guard';
import { AuditService } from '../audit/audit.service';
import { type AuthUser, CurrentUser, Roles, UserAuthGuard } from '../auth/auth.guard';
import { formatEtb } from '../pricing/fare-engine';

const recordSchema = z.strictObject({
  method: z.enum(['cash', 'ebirr']),
  ebirrReference: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{4,40}$/, 'letters, numbers and dashes only')
    .optional(),
});
const disputeSchema = z.strictObject({ note: z.string().trim().min(5).max(500) });
const resolveSchema = z.strictObject({ note: z.string().trim().min(5).max(500) });
const listSchema = z.strictObject({
  status: z.enum(['pending', 'driver_recorded', 'confirmed', 'disputed', 'resolved']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * Ride payment RECORDS (BR-01, BR-02). Passengers pay drivers directly; Horide only records
 * what each side reports. Protections against fake confirmations: only the trip's own driver and
 * passenger, only after the trip is completed, once per party, and every disagreement goes to a
 * finance admin. An eBirr reference is recorded as typed; it is NOT verified (no eBirr API yet, OA-10).
 */
@Controller()
export class PaymentsController {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    private readonly audit: AuditService,
  ) {}

  /** Driver: "I received the payment" (and how). */
  @Post('trips/:id/payment/received')
  @HttpCode(200)
  @UseGuards(UserAuthGuard)
  @Roles('driver')
  async driverRecords(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) tripId: string,
    @Body(new ZodValidationPipe(recordSchema)) body: z.infer<typeof recordSchema>,
  ) {
    if (body.method === 'ebirr' && !body.ebirrReference) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'REFERENCE_REQUIRED',
        'Enter the eBirr transaction reference.',
      );
    }
    if (body.method === 'cash' && body.ebirrReference) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'REFERENCE_NOT_ALLOWED',
        'Cash payments have no reference.',
      );
    }
    await this.db.transaction().execute(async (trx) => {
      const payment = await this.paymentForParty(trx, tripId, 'driver', user.id);
      this.assertNotResolved(payment.status);
      await this.confirmOnce(trx, payment.id, 'driver', 'confirmed', null);
      await trx
        .updateTable('payments')
        .set({
          method: body.method,
          ebirr_reference: body.ebirrReference ?? null,
          driver_recorded_at: sql`now()`,
          status: await this.nextStatus(trx, payment.id),
        })
        .where('id', '=', payment.id)
        .execute();
    });
    return this.receiptFor(tripId);
  }

  /** Passenger: "Yes, I paid this." */
  @Post('trips/:id/payment/confirm')
  @HttpCode(200)
  @UseGuards(UserAuthGuard)
  @Roles('passenger')
  async passengerConfirms(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) tripId: string,
  ) {
    await this.db.transaction().execute(async (trx) => {
      const payment = await this.paymentForParty(trx, tripId, 'passenger', user.id);
      this.assertNotResolved(payment.status);
      await this.confirmOnce(trx, payment.id, 'passenger', 'confirmed', null);
      await trx
        .updateTable('payments')
        .set({ status: await this.nextStatus(trx, payment.id) })
        .where('id', '=', payment.id)
        .execute();
    });
    return this.receiptFor(tripId);
  }

  /** Either party: "Something is wrong with this payment." Goes to a finance admin. */
  @Post('trips/:id/payment/dispute')
  @HttpCode(200)
  @UseGuards(UserAuthGuard)
  @Roles('passenger', 'driver')
  async dispute(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) tripId: string,
    @Body(new ZodValidationPipe(disputeSchema)) body: z.infer<typeof disputeSchema>,
  ) {
    await this.db.transaction().execute(async (trx) => {
      const payment = await this.paymentForParty(trx, tripId, user.role, user.id);
      this.assertNotResolved(payment.status);
      // A party who already confirmed can still raise a dispute (e.g. eBirr transfer later reversed),
      // so this replaces their earlier answer rather than being blocked by it.
      await trx
        .deleteFrom('payment_confirmations')
        .where('payment_id', '=', payment.id)
        .where('party', '=', user.role)
        .execute();
      await this.confirmOnce(trx, payment.id, user.role, 'disputed', body.note);
      await trx
        .updateTable('payments')
        .set({ status: 'disputed' })
        .where('id', '=', payment.id)
        .execute();
    });
    return this.receiptFor(tripId);
  }

  /** Receipt for either party once the trip is completed. */
  @Get('trips/:id/receipt')
  @UseGuards(UserAuthGuard)
  @Roles('passenger', 'driver')
  async receipt(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) tripId: string) {
    const column = user.role === 'passenger' ? 'passenger_id' : 'driver_id';
    const owns = await this.db
      .selectFrom('trips')
      .select('id')
      .where('id', '=', tripId)
      .where(column, '=', user.id)
      .executeTakeFirst();
    if (!owns) throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Trip not found.');
    const receipt = await this.receiptFor(tripId);
    if (!receipt)
      throw new AppError(
        HttpStatus.NOT_FOUND,
        'NO_RECEIPT',
        'A receipt is available once the trip is completed.',
      );
    return receipt;
  }

  @Get('admin/payments')
  @UseGuards(AdminGuard)
  @RequirePermission('payments.read')
  async adminList(@Query(new ZodValidationPipe(listSchema)) q: z.infer<typeof listSchema>) {
    let query = this.db
      .selectFrom('payments as p')
      .innerJoin('trips as t', 't.id', 'p.trip_id')
      .select([
        'p.id',
        'p.trip_id',
        'p.method',
        'p.amount',
        'p.status',
        'p.ebirr_reference',
        'p.driver_recorded_at',
        'p.created_at',
        't.passenger_id',
        't.driver_id',
        't.completed_at',
      ])
      .orderBy('p.created_at', 'desc')
      .limit(q.limit);
    if (q.status) query = query.where('p.status', '=', q.status);
    const payments = await query.execute();
    const confirmations = payments.length
      ? await this.db
          .selectFrom('payment_confirmations')
          .selectAll()
          .where(
            'payment_id',
            'in',
            payments.map((p) => p.id),
          )
          .execute()
      : [];
    return {
      payments: payments.map((p) => ({
        ...p,
        confirmations: confirmations.filter((c) => c.payment_id === p.id),
      })),
    };
  }

  @Post('admin/payments/:id/resolve')
  @HttpCode(204)
  @UseGuards(AdminGuard)
  @RequirePermission('payments.resolve')
  async resolve(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(resolveSchema)) body: z.infer<typeof resolveSchema>,
    @Req() req: Request,
  ) {
    await this.db.transaction().execute(async (trx) => {
      const before = await trx
        .selectFrom('payments')
        .selectAll()
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (!before) throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Payment not found.');
      if (before.status !== 'disputed') {
        throw new AppError(
          HttpStatus.CONFLICT,
          'NOT_DISPUTED',
          'Only disputed payments can be resolved.',
        );
      }
      await trx
        .updateTable('payments')
        .set({ status: 'resolved', resolved_by: admin.id, resolution_note: body.note })
        .where('id', '=', id)
        .execute();
      await this.audit.record(trx, {
        actorType: 'admin',
        actorId: admin.id,
        action: 'payment.dispute_resolved',
        entityType: 'payment',
        entityId: id,
        before: { status: before.status },
        after: { status: 'resolved', note: body.note },
        ip: req.ip ?? null,
      });
    });
  }

  /** Finds the payment of a COMPLETED trip that this user took part in, locked for update. */
  private async paymentForParty(
    trx: Transaction<DB>,
    tripId: string,
    party: 'passenger' | 'driver',
    userId: string,
  ) {
    const column = party === 'passenger' ? 't.passenger_id' : 't.driver_id';
    const row = await trx
      .selectFrom('payments as p')
      .innerJoin('trips as t', 't.id', 'p.trip_id')
      .select(['p.id', 'p.status', 't.status as trip_status'])
      .where('p.trip_id', '=', tripId)
      .where(column, '=', userId)
      .forUpdate('p')
      .executeTakeFirst();
    if (!row) {
      // Also covers "not your trip" and "trip not completed yet" (no payment record exists before completion).
      throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'No payment to record for this trip.');
    }
    return row;
  }

  /** Once a finance admin has resolved a payment, neither party can change it. */
  private assertNotResolved(status: PaymentStatus): void {
    if (status === 'resolved') {
      throw new AppError(
        HttpStatus.CONFLICT,
        'PAYMENT_RESOLVED',
        'This payment has already been resolved by Horide.',
      );
    }
  }

  private async confirmOnce(
    trx: Transaction<DB>,
    paymentId: string,
    party: 'passenger' | 'driver',
    outcome: 'confirmed' | 'disputed',
    note: string | null,
  ): Promise<void> {
    const inserted = await trx
      .insertInto('payment_confirmations')
      .values({ payment_id: paymentId, party, outcome, note })
      .onConflict((oc) => oc.columns(['payment_id', 'party']).doNothing())
      .returning('id')
      .executeTakeFirst();
    if (!inserted)
      throw new AppError(
        HttpStatus.CONFLICT,
        'ALREADY_ANSWERED',
        'You have already answered for this payment.',
      );
  }

  /** confirmed only when BOTH parties confirmed; disputed if either disputed. */
  private async nextStatus(trx: Transaction<DB>, paymentId: string): Promise<PaymentStatus> {
    const rows = await trx
      .selectFrom('payment_confirmations')
      .select(['party', 'outcome'])
      .where('payment_id', '=', paymentId)
      .execute();
    if (rows.some((r) => r.outcome === 'disputed')) return 'disputed';
    const driver = rows.some((r) => r.party === 'driver');
    const passenger = rows.some((r) => r.party === 'passenger');
    if (driver && passenger) return 'confirmed';
    return driver ? 'driver_recorded' : 'pending';
  }

  private async receiptFor(tripId: string) {
    const r = await this.db
      .selectFrom('trips as t')
      .innerJoin('payments as p', 'p.trip_id', 't.id')
      .leftJoin('vehicles as v', 'v.id', 't.vehicle_id')
      .leftJoin('driver_profiles as d', 'd.user_id', 't.driver_id')
      .select([
        't.id as trip_id',
        't.category',
        't.pickup_text',
        't.destination_text',
        't.route_distance_m',
        't.route_is_estimate',
        't.started_at',
        't.completed_at',
        't.final_fare',
        'p.method',
        'p.status as payment_status',
        'p.ebirr_reference',
        'd.full_name as driver_name',
        'v.plate_number',
      ])
      .where('t.id', '=', tripId)
      .executeTakeFirst();
    if (!r) return null;
    return {
      ...r,
      finalFareEtb: r.final_fare ? formatEtb(BigInt(r.final_fare)) : null,
      note: 'Paid directly to the driver. Horide does not collect ride payments.',
    };
  }
}
