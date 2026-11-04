import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Kysely } from 'kysely';
import { z } from 'zod';
import { AppError } from '../../common/errors';
import { geoPoint, latLngSchema, latOf, lngOf } from '../../common/geo';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { DATABASE } from '../../database/database.module';
import type { DB } from '../../database/types';
import { type AuthUser, CurrentUser, Roles, UserAuthGuard } from '../auth/auth.guard';
import { normalizeEthiopianMobile } from '../auth/phone';
import { AccountService } from './account.service';

export const MAX_SAVED_LOCATIONS = 10;

const profileSchema = z.strictObject({
  fullName: z.string().trim().min(1).max(120).optional(),
  emergencyContactPhone: z.string().max(25).nullable().optional(),
});
const savedLocationSchema = z.strictObject({
  label: z.string().trim().min(1).max(40),
  position: latLngSchema,
  addressText: z.string().trim().max(200).optional(),
});

@Controller('passenger')
@UseGuards(UserAuthGuard)
@Roles('passenger')
export class PassengerController {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    private readonly accounts: AccountService,
  ) {}

  @Get('profile')
  async getProfile(@CurrentUser() user: AuthUser) {
    return this.db
      .selectFrom('users as u')
      .innerJoin('passenger_profiles as p', 'p.user_id', 'u.id')
      .select(['u.id', 'u.phone', 'u.status', 'p.full_name', 'p.emergency_contact_phone'])
      .where('u.id', '=', user.id)
      .executeTakeFirstOrThrow();
  }

  @Patch('profile')
  async updateProfile(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(profileSchema)) body: z.infer<typeof profileSchema>,
  ) {
    await this.accounts.requireActive(user.id);
    let emergency: string | null | undefined = undefined;
    if (body.emergencyContactPhone !== undefined) {
      emergency =
        body.emergencyContactPhone === null
          ? null
          : normalizeEthiopianMobile(body.emergencyContactPhone);
      if (emergency === null && body.emergencyContactPhone !== null) {
        throw new AppError(
          HttpStatus.BAD_REQUEST,
          'INVALID_PHONE',
          'Enter a valid Ethiopian mobile number.',
        );
      }
    }
    await this.db
      .updateTable('passenger_profiles')
      .set({
        ...(body.fullName !== undefined ? { full_name: body.fullName } : {}),
        ...(emergency !== undefined ? { emergency_contact_phone: emergency } : {}),
      })
      .where('user_id', '=', user.id)
      .execute();
    return this.getProfile(user);
  }

  @Get('saved-locations')
  async listSaved(@CurrentUser() user: AuthUser) {
    const locations = await this.db
      .selectFrom('saved_locations')
      .select([
        'id',
        'label',
        'address_text',
        latOf('position').as('lat'),
        lngOf('position').as('lng'),
      ])
      .where('passenger_id', '=', user.id) // ownership in every query: no IDOR
      .orderBy('label')
      .execute();
    return { locations };
  }

  @Post('saved-locations')
  @HttpCode(201)
  async addSaved(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(savedLocationSchema)) body: z.infer<typeof savedLocationSchema>,
  ) {
    await this.accounts.requireActive(user.id);
    return this.db.transaction().execute(async (trx) => {
      const count = await trx
        .selectFrom('saved_locations')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('passenger_id', '=', user.id)
        .executeTakeFirstOrThrow();
      if (Number(count.n) >= MAX_SAVED_LOCATIONS) {
        throw new AppError(
          HttpStatus.BAD_REQUEST,
          'SAVED_LOCATIONS_LIMIT',
          `You can save up to ${MAX_SAVED_LOCATIONS} places.`,
        );
      }
      const exists = await trx
        .selectFrom('saved_locations')
        .select('id')
        .where('passenger_id', '=', user.id)
        .where('label', '=', body.label)
        .executeTakeFirst();
      if (exists) {
        throw new AppError(
          HttpStatus.CONFLICT,
          'LABEL_EXISTS',
          'You already have a place with this name.',
        );
      }
      return trx
        .insertInto('saved_locations')
        .values({
          passenger_id: user.id,
          label: body.label,
          position: geoPoint(body.position),
          address_text: body.addressText ?? null,
        })
        .returning(['id', 'label'])
        .executeTakeFirstOrThrow();
    });
  }

  @Delete('saved-locations/:id')
  @HttpCode(204)
  async deleteSaved(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const res = await this.db
      .deleteFrom('saved_locations')
      .where('id', '=', id)
      .where('passenger_id', '=', user.id)
      .executeTakeFirst();
    // Same answer for "not yours" and "doesn't exist", so IDs of other users can't be probed.
    if (Number(res.numDeletedRows) === 0) {
      throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Saved place not found.');
    }
  }
}
