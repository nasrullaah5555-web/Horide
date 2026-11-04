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
import { Kysely, sql } from 'kysely';
import { z } from 'zod';
import { AppError } from '../../common/errors';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { DATABASE } from '../../database/database.module';
import type { DB } from '../../database/types';
import type { AdminPrincipal } from '../admin-auth/admin-auth.service';
import { AdminGuard, CurrentAdmin, RequirePermission } from '../admin-auth/admin.guard';
import { AuditService } from '../audit/audit.service';

const etbToSantim = z
  .number()
  .min(0)
  .max(1_000_000)
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'at most 2 decimal places')
  .transform((v) => Math.round(v * 100).toString());

const planSchema = z.strictObject({
  name: z.string().trim().min(1).max(60),
  category: z.enum(['car', 'bajaj']).nullable().default(null),
  price: etbToSantim,
  durationDays: z.number().int().min(1).max(366),
});

/**
 * Recording a subscription payment received from a driver (cash, eBirr transfer, bank).
 * Horide verifies the money arrived OUTSIDE the app; this records it and extends the subscription.
 */
const recordPaymentSchema = z.strictObject({
  driverId: z.string().uuid(),
  planId: z.string().uuid(),
  amount: etbToSantim,
  method: z.enum(['cash', 'ebirr']),
  reference: z.string().trim().max(60).optional(),
  receivedAt: z.coerce.date(),
  note: z.string().trim().max(300).optional(),
});

const cancelSchema = z.strictObject({ reason: z.string().trim().min(3).max(300) });

const listSchema = z.strictObject({
  status: z.enum(['active', 'expiring', 'expired']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

@Controller('admin')
@UseGuards(AdminGuard)
export class SubscriptionsController {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    private readonly audit: AuditService,
  ) {}

  @Get('subscription-plans')
  @RequirePermission('subscriptions.read')
  async plans() {
    return {
      plans: await this.db
        .selectFrom('subscription_plans')
        .selectAll()
        .orderBy('created_at')
        .execute(),
    };
  }

  @Post('subscription-plans')
  @HttpCode(201)
  @RequirePermission('subscriptions.write')
  async createPlan(
    @CurrentAdmin() admin: AdminPrincipal,
    @Body(new ZodValidationPipe(planSchema)) body: z.infer<typeof planSchema>,
    @Req() req: Request,
  ) {
    return this.db.transaction().execute(async (trx) => {
      const exists = await trx
        .selectFrom('subscription_plans')
        .select('id')
        .where('name', '=', body.name)
        .executeTakeFirst();
      if (exists)
        throw new AppError(
          HttpStatus.CONFLICT,
          'PLAN_EXISTS',
          'A plan with this name already exists.',
        );
      const plan = await trx
        .insertInto('subscription_plans')
        .values({
          name: body.name,
          category: body.category,
          price: body.price,
          duration_days: body.durationDays,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.audit.record(trx, {
        actorType: 'admin',
        actorId: admin.id,
        action: 'subscription_plan.created',
        entityType: 'subscription_plan',
        entityId: plan.id,
        after: plan,
        ip: req.ip ?? null,
      });
      return plan;
    });
  }

  @Post('subscription-plans/:id/deactivate')
  @HttpCode(204)
  @RequirePermission('subscriptions.write')
  async deactivatePlan(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    await this.db.transaction().execute(async (trx) => {
      const plan = await trx
        .updateTable('subscription_plans')
        .set({ active: false })
        .where('id', '=', id)
        .returning('id')
        .executeTakeFirst();
      if (!plan) throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Plan not found.');
      await this.audit.record(trx, {
        actorType: 'admin',
        actorId: admin.id,
        action: 'subscription_plan.deactivated',
        entityType: 'subscription_plan',
        entityId: id,
        ip: req.ip ?? null,
      });
    });
  }

  /**
   * Records a payment and creates the next subscription period in one transaction.
   * If the driver already has active time, the new period starts when the current one ends
   * (renewing early never loses days). Otherwise it starts now.
   */
  @Post('subscriptions')
  @HttpCode(201)
  @RequirePermission('subscriptions.write')
  async recordPayment(
    @CurrentAdmin() admin: AdminPrincipal,
    @Body(new ZodValidationPipe(recordPaymentSchema)) body: z.infer<typeof recordPaymentSchema>,
    @Req() req: Request,
  ) {
    if (body.method === 'ebirr' && !body.reference) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'REFERENCE_REQUIRED',
        'Enter the eBirr transaction reference.',
      );
    }
    if (body.receivedAt.getTime() > Date.now() + 5 * 60_000) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'FUTURE_PAYMENT_DATE',
        'The payment date cannot be in the future.',
      );
    }

    return this.db.transaction().execute(async (trx) => {
      // One renewal at a time per driver, so two admins can't create overlapping periods.
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'subscription:' + body.driverId}))`.execute(
        trx,
      );

      const driver = await trx
        .selectFrom('driver_profiles as d')
        .innerJoin('users as u', 'u.id', 'd.user_id')
        .select(['u.status'])
        .where('d.user_id', '=', body.driverId)
        .executeTakeFirst();
      if (!driver || driver.status === 'deleted')
        throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Driver not found.');

      const plan = await trx
        .selectFrom('subscription_plans')
        .selectAll()
        .where('id', '=', body.planId)
        .executeTakeFirst();
      if (!plan || !plan.active)
        throw new AppError(
          HttpStatus.BAD_REQUEST,
          'PLAN_UNAVAILABLE',
          'This plan is not available.',
        );
      if (body.amount !== plan.price) {
        throw new AppError(
          HttpStatus.BAD_REQUEST,
          'AMOUNT_MISMATCH',
          'The amount does not match the plan price.',
          {
            planPrice: plan.price,
          },
        );
      }

      const latest = await trx
        .selectFrom('subscriptions')
        .select(sql<Date | null>`max(ends_at)`.as('ends_at'))
        .where('driver_id', '=', body.driverId)
        .where('status', '=', 'active')
        .where('ends_at', '>', sql<Date>`now()`)
        .executeTakeFirstOrThrow();

      const startsAt = latest.ends_at ? new Date(latest.ends_at) : new Date();
      const endsAt = new Date(startsAt.getTime() + plan.duration_days * 86_400_000);

      const subscription = await trx
        .insertInto('subscriptions')
        .values({
          driver_id: body.driverId,
          plan_id: plan.id,
          starts_at: startsAt,
          ends_at: endsAt,
          created_by: admin.id,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      const payment = await trx
        .insertInto('subscription_payments')
        .values({
          subscription_id: subscription.id,
          amount: body.amount,
          method: body.method,
          reference: body.reference ?? null,
          received_at: body.receivedAt,
          recorded_by: admin.id,
          note: body.note ?? null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.audit.record(trx, {
        actorType: 'admin',
        actorId: admin.id,
        action: 'subscription.payment_recorded',
        entityType: 'subscription',
        entityId: subscription.id,
        after: {
          driverId: body.driverId,
          plan: plan.name,
          amount: body.amount,
          method: body.method,
          reference: body.reference ?? null,
          startsAt,
          endsAt,
        },
        ip: req.ip ?? null,
      });
      return { subscription, payment };
    });
  }

  /** Cancels a period (e.g. payment recorded by mistake). Never interrupts a trip in progress (BR-05). */
  @Post('subscriptions/:id/cancel')
  @HttpCode(204)
  @RequirePermission('subscriptions.write')
  async cancel(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(cancelSchema)) body: z.infer<typeof cancelSchema>,
    @Req() req: Request,
  ) {
    await this.db.transaction().execute(async (trx) => {
      const sub = await trx
        .updateTable('subscriptions')
        .set({ status: 'cancelled' })
        .where('id', '=', id)
        .where('status', '=', 'active')
        .returning(['id', 'driver_id'])
        .executeTakeFirst();
      if (!sub)
        throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Active subscription not found.');
      await this.audit.record(trx, {
        actorType: 'admin',
        actorId: admin.id,
        action: 'subscription.cancelled',
        entityType: 'subscription',
        entityId: id,
        after: { driverId: sub.driver_id, reason: body.reason },
        ip: req.ip ?? null,
      });
    });
  }

  @Get('subscriptions')
  @RequirePermission('subscriptions.read')
  async list(@Query(new ZodValidationPipe(listSchema)) q: z.infer<typeof listSchema>) {
    let query = this.db
      .selectFrom('subscriptions as s')
      .innerJoin('subscription_plans as p', 'p.id', 's.plan_id')
      .innerJoin('driver_profiles as d', 'd.user_id', 's.driver_id')
      .innerJoin('users as u', 'u.id', 's.driver_id')
      .select([
        's.id',
        's.driver_id',
        'd.full_name',
        'u.phone',
        'p.name as plan_name',
        's.status',
        's.starts_at',
        's.ends_at',
      ])
      .orderBy('s.ends_at', 'asc')
      .limit(q.limit);
    if (q.status === 'active') {
      query = query.where('s.status', '=', 'active').where('s.ends_at', '>', sql<Date>`now()`);
    } else if (q.status === 'expiring') {
      query = query
        .where('s.status', '=', 'active')
        .where('s.ends_at', '>', sql<Date>`now()`)
        .where('s.ends_at', '<=', sql<Date>`now() + interval '7 days'`);
    } else if (q.status === 'expired') {
      query = query.where('s.ends_at', '<=', sql<Date>`now()`);
    }
    return { subscriptions: await query.execute() };
  }

  @Get('drivers/:id/subscription-payments')
  @RequirePermission('subscriptions.read')
  async payments(@Param('id', ParseUUIDPipe) id: string) {
    const payments = await this.db
      .selectFrom('subscription_payments as sp')
      .innerJoin('subscriptions as s', 's.id', 'sp.subscription_id')
      .select([
        'sp.id',
        'sp.amount',
        'sp.method',
        'sp.reference',
        'sp.received_at',
        'sp.recorded_by',
        'sp.note',
        's.starts_at',
        's.ends_at',
        's.status',
      ])
      .where('s.driver_id', '=', id)
      .orderBy('sp.received_at', 'desc')
      .execute();
    return { payments };
  }
}
