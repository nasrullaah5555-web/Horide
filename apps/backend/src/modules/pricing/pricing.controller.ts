import { RateLimit } from '../../common/rate-limit';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { Kysely, sql } from 'kysely';
import { z } from 'zod';
import { AppError } from '../../common/errors';
import { latLngSchema } from '../../common/geo';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { DATABASE } from '../../database/database.module';
import type { DB, VehicleCategory } from '../../database/types';
import type { AdminPrincipal } from '../admin-auth/admin-auth.service';
import { AdminGuard, CurrentAdmin, RequirePermission } from '../admin-auth/admin.guard';
import { AuditService } from '../audit/audit.service';
import { type AuthUser, CurrentUser, Roles, UserAuthGuard } from '../auth/auth.guard';
import { AccountService } from '../users/account.service';
import { formatEtb } from './fare-engine';
import { PricingService } from './pricing.service';

const quoteSchema = z.strictObject({
  pickup: latLngSchema,
  destination: latLngSchema,
  pickupText: z.string().trim().max(200).optional(),
  destinationText: z.string().trim().max(200).optional(),
  categories: z
    .array(z.enum(['car', 'bajaj']))
    .min(1)
    .max(2)
    .default(['car', 'bajaj']),
  paymentMethod: z.enum(['cash', 'ebirr']).default('cash'),
});

/** Admins enter prices in ETB (e.g. 40, 15.5). Stored as integer santim. */
const etb = (max: number) =>
  z
    .number()
    .min(0)
    .max(max)
    .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'at most 2 decimal places')
    .transform((v) => BigInt(Math.round(v * 100)));

const fareVersionSchema = z.strictObject({
  baseFare: etb(10_000),
  perKm: etb(1_000),
  minimumFare: etb(10_000),
  roundingUnit: etb(100).refine((v) => v > 0n, 'must be greater than 0'),
  waitingPerMin: etb(1_000).optional(),
  freeWaitingMinutes: z.number().int().min(0).max(60).optional(),
  cancellationFee: etb(10_000).optional(),
  note: z.string().trim().min(3).max(200),
});

const zoneSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  // GeoJSON-style ring of [lng, lat] pairs; closed automatically if needed.
  ring: z
    .array(z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]))
    .min(3)
    .max(500),
  active: z.boolean().default(true),
});

@Controller()
export class PricingController {
  constructor(
    private readonly pricing: PricingService,
    private readonly accounts: AccountService,
    private readonly audit: AuditService,
    @Inject(DATABASE) private readonly db: Kysely<DB>,
  ) {}

  /** Passenger asks for prices before booking. Fares are only ever computed here, on the server. */
  @RateLimit({ name: 'quotes', limit: 20, windowSeconds: 60 })
  @Post('quotes')
  @HttpCode(200)
  @UseGuards(UserAuthGuard)
  @Roles('passenger')
  async quote(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(quoteSchema)) body: z.infer<typeof quoteSchema>,
  ) {
    await this.accounts.requireActive(user.id);
    const quotes = await this.pricing.quote({ passengerId: user.id, ...body });
    return { quotes };
  }

  @Get('admin/pricing')
  @UseGuards(AdminGuard)
  @RequirePermission('pricing.read')
  async adminPricing() {
    const current = await this.db
      .selectFrom('fare_settings as s')
      .innerJoin('fare_versions as v', 'v.id', 's.current_version_id')
      .selectAll('v')
      .execute();
    const history = await this.db
      .selectFrom('fare_versions')
      .selectAll()
      .orderBy('created_at', 'desc')
      .limit(50)
      .execute();
    return { current, history };
  }

  /** Changing prices creates a new immutable version. Trips already quoted keep their old price. */
  @Post('admin/pricing/:category')
  @HttpCode(201)
  @UseGuards(AdminGuard)
  @RequirePermission('pricing.write')
  async newFareVersion(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('category') categoryParam: string,
    @Body(new ZodValidationPipe(fareVersionSchema)) body: z.infer<typeof fareVersionSchema>,
    @Req() req: Request,
  ) {
    const category = z.enum(['car', 'bajaj']).safeParse(categoryParam);
    if (!category.success)
      throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Unknown vehicle category.');
    if (body.minimumFare < body.baseFare) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'MINIMUM_BELOW_BASE',
        'Minimum fare should not be lower than the base fare.',
      );
    }
    const cat: VehicleCategory = category.data;
    return this.db.transaction().execute(async (trx) => {
      const before = await trx
        .selectFrom('fare_settings as s')
        .innerJoin('fare_versions as v', 'v.id', 's.current_version_id')
        .selectAll('v')
        .where('s.category', '=', cat)
        .executeTakeFirst();
      const version = await trx
        .insertInto('fare_versions')
        .values({
          category: cat,
          base_fare: body.baseFare.toString(),
          per_km: body.perKm.toString(),
          minimum_fare: body.minimumFare.toString(),
          rounding_unit: body.roundingUnit.toString(),
          waiting_per_min: (body.waitingPerMin ?? 0n).toString(),
          free_waiting_minutes: body.freeWaitingMinutes ?? 3,
          cancellation_fee: (body.cancellationFee ?? 0n).toString(),
          note: body.note,
          created_by: admin.id,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('fare_settings')
        .values({ category: cat, current_version_id: version.id, updated_by: admin.id })
        .onConflict((oc) =>
          oc
            .column('category')
            .doUpdateSet({ current_version_id: version.id, updated_by: admin.id }),
        )
        .execute();
      await this.audit.record(trx, {
        actorType: 'admin',
        actorId: admin.id,
        action: 'pricing.changed',
        entityType: 'fare_version',
        entityId: version.id,
        before: before ?? null,
        after: version,
        ip: req.ip ?? null,
      });
      return {
        ...version,
        example5km: formatEtb(BigInt(version.base_fare) + BigInt(version.per_km) * 5n),
      };
    });
  }

  @Get('admin/zones')
  @UseGuards(AdminGuard)
  @RequirePermission('pricing.read')
  async zones() {
    const zones = await this.db
      .selectFrom('service_zones')
      .select(['id', 'name', 'active', 'updated_at', sql<string>`ST_AsGeoJSON(area)`.as('geojson')])
      .orderBy('name')
      .execute();
    return { zones: zones.map((z) => ({ ...z, geojson: JSON.parse(z.geojson) })) };
  }

  @Post('admin/zones')
  @HttpCode(201)
  @UseGuards(AdminGuard)
  @RequirePermission('zones.write')
  async upsertZone(
    @CurrentAdmin() admin: AdminPrincipal,
    @Body(new ZodValidationPipe(zoneSchema)) body: z.infer<typeof zoneSchema>,
    @Req() req: Request,
  ) {
    const ring = [...body.ring];
    const first = ring[0]!;
    const last = ring[ring.length - 1]!;
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
    const geojson = JSON.stringify({ type: 'Polygon', coordinates: [ring] });
    return this.db.transaction().execute(async (trx) => {
      const valid = await sql<{ ok: boolean; reason: string }>`
        SELECT ST_IsValid(g) AS ok, ST_IsValidReason(g) AS reason FROM ST_GeomFromGeoJSON(${geojson}) g`.execute(
        trx,
      );
      if (!valid.rows[0]?.ok) {
        throw new AppError(
          HttpStatus.BAD_REQUEST,
          'INVALID_ZONE',
          `The zone shape is invalid: ${valid.rows[0]?.reason}`,
        );
      }
      const zone = await trx
        .insertInto('service_zones')
        .values({
          name: body.name,
          area: sql`ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326)::geography`,
          active: body.active,
        })
        .onConflict((oc) =>
          oc.column('name').doUpdateSet({
            area: sql`ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326)::geography`,
            active: body.active,
          }),
        )
        .returning(['id', 'name', 'active'])
        .executeTakeFirstOrThrow();
      await this.audit.record(trx, {
        actorType: 'admin',
        actorId: admin.id,
        action: 'zone.saved',
        entityType: 'service_zone',
        entityId: zone.id,
        after: { name: body.name, active: body.active, points: ring.length },
        ip: req.ip ?? null,
      });
      return zone;
    });
  }
}
