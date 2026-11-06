import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Injectable,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../../common/errors';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/env';
import { DATABASE } from '../../database/database.module';
import type { DB, TripStatus } from '../../database/types';
import { type AuthUser, CurrentUser, Roles, UserAuthGuard } from '../auth/auth.guard';
import { sha256Hex } from '../auth/tokens';
import { AccountService } from '../users/account.service';
import { TripViewsService } from './trip-views.service';

const MAX_SHARES_PER_TRIP = 5;
const SHAREABLE: TripStatus[] = [
  'requested',
  'searching',
  'accepted',
  'driver_arriving',
  'arrived',
  'in_progress',
];

/**
 * "Share my trip": a passenger sends a link; whoever opens it sees the trip's progress, the car
 * and the driver's position, and nothing else (no phone numbers, no passenger details). The link
 * stops showing anything once the trip ends. The secret travels in the URL fragment (#…), which
 * browsers never send to web servers, and only its hash is stored.
 */
@Injectable()
export class TripSharesService {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly views: TripViewsService,
  ) {}

  async create(passengerId: string, tripId: string): Promise<{ url: string }> {
    const base = this.config.PUBLIC_WEB_URL;
    if (!base) {
      throw new AppError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'SHARING_NOT_SET_UP',
        'Sharing is not available yet.',
      );
    }
    const token = randomBytes(24).toString('base64url');
    await this.db.transaction().execute(async (trx) => {
      const trip = await trx
        .selectFrom('trips')
        .select('status')
        .where('id', '=', tripId)
        .where('passenger_id', '=', passengerId) // ownership in the query: no IDOR
        .forUpdate()
        .executeTakeFirst();
      if (!trip) throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Trip not found.');
      if (!SHAREABLE.includes(trip.status)) {
        throw new AppError(HttpStatus.CONFLICT, 'TRIP_ENDED', 'This trip has already ended.');
      }
      const { n } = await trx
        .selectFrom('trip_shares')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('trip_id', '=', tripId)
        .executeTakeFirstOrThrow();
      if (Number(n) >= MAX_SHARES_PER_TRIP) {
        throw new AppError(
          HttpStatus.TOO_MANY_REQUESTS,
          'TOO_MANY_SHARES',
          'You have shared this trip enough times. Send one of the links you already shared.',
        );
      }
      await trx
        .insertInto('trip_shares')
        .values({ trip_id: tripId, token_hash: sha256Hex(token) })
        .execute();
    });
    return { url: `${base.replace(/\/+$/, '')}/share/#${token}` };
  }

  /** What someone with the link sees. Unknown and ended links look the same: "ended". */
  async view(token: string) {
    const row = await this.db
      .selectFrom('trip_shares as s')
      .innerJoin('trips as t', 't.id', 's.trip_id')
      .select([
        's.id as share_id',
        't.id',
        't.status',
        't.category',
        't.driver_id',
        't.vehicle_id',
        't.pickup_text',
        't.destination_text',
      ])
      .where('s.token_hash', '=', sha256Hex(token))
      .executeTakeFirst();
    if (!row || !SHAREABLE.includes(row.status)) return { status: 'ended' as const };
    await this.db
      .updateTable('trip_shares')
      .set({ last_viewed_at: sql`now()` })
      .where('id', '=', row.share_id)
      .execute();

    let driver: Record<string, unknown> | null = null;
    if (row.driver_id && row.vehicle_id) {
      const d = await this.db
        .selectFrom('driver_profiles as d')
        .innerJoin('vehicles as v', (j) => j.on('v.id', '=', row.vehicle_id!))
        .select(['d.full_name', 'v.make', 'v.model', 'v.colour', 'v.plate_number'])
        .where('d.user_id', '=', row.driver_id)
        .executeTakeFirst();
      if (d) {
        driver = {
          // First name only: enough to recognise, not enough to look someone up.
          firstName: d.full_name?.trim().split(/\s+/)[0] ?? null,
          vehicle: `${d.colour} ${d.make} ${d.model}`,
          plate: d.plate_number,
          location: await this.views.driverLocation(row.driver_id),
        };
      }
    }
    return {
      status: row.status,
      category: row.category,
      pickup: row.pickup_text,
      destination: row.destination_text,
      driver,
    };
  }
}

const tokenSchema = z.strictObject({ token: z.string().regex(/^[A-Za-z0-9_-]{32}$/) });

@Controller()
export class TripSharesController {
  constructor(
    private readonly shares: TripSharesService,
    private readonly accounts: AccountService,
  ) {}

  @Post('trips/:id/share')
  @HttpCode(201)
  @UseGuards(UserAuthGuard)
  @Roles('passenger')
  async create(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.accounts.requireActive(user.id);
    return this.shares.create(user.id, id);
  }

  /** Public on purpose (the family member has no account); the secret is the authorisation. */
  @Post('share/view')
  @HttpCode(200)
  async view(@Body(new ZodValidationPipe(tokenSchema)) body: z.infer<typeof tokenSchema>) {
    return this.shares.view(body.token);
  }
}
