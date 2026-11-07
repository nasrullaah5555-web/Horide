import { RateLimit } from '../../common/rate-limit';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Kysely, sql } from 'kysely';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../../common/errors';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { DATABASE } from '../../database/database.module';
import type { DB } from '../../database/types';
import { type AuthUser, CurrentUser, Roles, UserAuthGuard } from '../auth/auth.guard';
import {
  MAX_DOCUMENT_BYTES,
  sniffDocumentType,
  STORAGE_PROVIDER,
  type StorageProvider,
} from '../storage/storage.provider';
import { AccountService } from '../users/account.service';
import { normalizePlate, PASSENGER_VISIBLE_PHOTOS, VEHICLE_DOCUMENTS } from './driver-requirements';
import { DriverEligibilityService } from './driver-eligibility.service';

const DOC_TYPES = [
  'national_id',
  'driving_licence',
  'vehicle_registration',
  'permit',
  'insurance',
  'profile_photo',
  'vehicle_photo',
] as const;

const profileSchema = z.strictObject({ fullName: z.string().trim().min(1).max(120) });
const vehicleSchema = z.strictObject({
  category: z.enum(['car', 'bajaj']),
  make: z.string().trim().min(1).max(40),
  model: z.string().trim().min(1).max(40),
  colour: z.string().trim().min(1).max(30),
  year: z
    .number()
    .int()
    .min(1980)
    .max(new Date().getFullYear() + 1)
    .optional(),
  plateNumber: z
    .string()
    .max(30)
    .transform(normalizePlate)
    .pipe(z.string().regex(/^[A-Z0-9-]{3,15}$/, 'invalid plate number')),
});
const documentFieldsSchema = z.strictObject({
  type: z.enum(DOC_TYPES),
  vehicleId: z.string().uuid().optional(),
  expiresOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

interface UploadedFileLike {
  buffer: Buffer;
  size: number;
}

@Controller('driver')
@UseGuards(UserAuthGuard)
@Roles('driver')
export class DriverController {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly accounts: AccountService,
    private readonly eligibility: DriverEligibilityService,
  ) {}

  /** Everything the driver app needs for the onboarding / status screen. */
  @Get('profile')
  async profile(@CurrentUser() user: AuthUser) {
    const profile = await this.db
      .selectFrom('users as u')
      .innerJoin('driver_profiles as d', 'd.user_id', 'u.id')
      .select([
        'u.id',
        'u.phone',
        'u.status',
        'u.suspended_reason',
        'd.full_name',
        'd.approval_status',
        'd.rating_avg',
        'd.rating_count',
      ])
      .where('u.id', '=', user.id)
      .executeTakeFirstOrThrow();
    const vehicles = await this.db
      .selectFrom('vehicles')
      .select([
        'id',
        'category',
        'make',
        'model',
        'colour',
        'year',
        'plate_number',
        'approval_status',
        'rejection_reason',
        'is_active',
      ])
      .where('driver_id', '=', user.id)
      .orderBy('created_at', 'desc')
      .execute();
    // Storage keys are internal and never returned to clients.
    const documents = await this.db
      .selectFrom('driver_documents')
      .select([
        'id',
        'type',
        'vehicle_id',
        'mime_type',
        'status',
        'rejection_reason',
        'expires_on',
        'created_at',
      ])
      .where('driver_id', '=', user.id)
      .orderBy('created_at', 'desc')
      .execute();
    // How often passengers gave each compliment, most given first.
    const compliments = await sql<{ tag: string; count: number }>`
      SELECT tag, count(*)::int AS count
      FROM ratings, unnest(compliments) AS tag
      WHERE ratee_id = ${user.id}
      GROUP BY tag ORDER BY count DESC, tag`.execute(this.db);
    return {
      profile,
      vehicles,
      documents,
      compliments: compliments.rows,
      eligibility: await this.eligibility.evaluate(user.id),
    };
  }

  @Patch('profile')
  async updateProfile(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(profileSchema)) body: z.infer<typeof profileSchema>,
  ) {
    await this.accounts.requireActive(user.id);
    const current = await this.db
      .selectFrom('driver_profiles')
      .select('approval_status')
      .where('user_id', '=', user.id)
      .executeTakeFirstOrThrow();
    if (current.approval_status === 'approved') {
      // The approved name must match the verified ID; changes go through support.
      throw new AppError(
        HttpStatus.CONFLICT,
        'PROFILE_LOCKED',
        'Your name is verified. Contact support to change it.',
      );
    }
    await this.db
      .updateTable('driver_profiles')
      .set({ full_name: body.fullName })
      .where('user_id', '=', user.id)
      .execute();
    return { fullName: body.fullName };
  }

  @Post('vehicles')
  @HttpCode(201)
  async addVehicle(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(vehicleSchema)) body: z.infer<typeof vehicleSchema>,
  ) {
    await this.accounts.requireActive(user.id);
    return this.db.transaction().execute(async (trx) => {
      const open = await trx
        .selectFrom('vehicles')
        .select('id')
        .where('driver_id', '=', user.id)
        .where('is_active', '=', true)
        .where('approval_status', 'in', ['pending', 'approved'])
        .executeTakeFirst();
      if (open) {
        throw new AppError(
          HttpStatus.CONFLICT,
          'VEHICLE_EXISTS',
          'You already have a vehicle registered. Contact support to change it.',
        );
      }
      const plateTaken = await trx
        .selectFrom('vehicles')
        .select('id')
        .where('plate_number', '=', body.plateNumber)
        .executeTakeFirst();
      if (plateTaken) {
        throw new AppError(
          HttpStatus.CONFLICT,
          'PLATE_TAKEN',
          'This plate number is already registered.',
        );
      }
      return trx
        .insertInto('vehicles')
        .values({
          driver_id: user.id,
          category: body.category,
          make: body.make,
          model: body.model,
          colour: body.colour,
          year: body.year ?? null,
          plate_number: body.plateNumber,
          approved_by: null,
          approved_at: null,
          rejection_reason: null,
        })
        .returning(['id', 'category', 'plate_number', 'approval_status'])
        .executeTakeFirstOrThrow();
    });
  }

  /**
   * Upload one document (multipart/form-data: file + type [+ vehicleId] [+ expiresOn]).
   * The file type is identified from its content; only JPEG, PNG and PDF up to 8 MB are accepted.
   */
  @RateLimit({ name: 'documents', limit: 10, windowSeconds: 60 })
  @Post('documents')
  @HttpCode(201)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1, fields: 5, fieldSize: 200 },
    }),
  )
  async uploadDocument(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedFileLike | undefined,
    @Body(new ZodValidationPipe(documentFieldsSchema)) body: z.infer<typeof documentFieldsSchema>,
  ) {
    await this.accounts.requireActive(user.id);
    if (!file || file.size === 0) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'FILE_REQUIRED',
        'Attach a photo or PDF of the document.',
      );
    }
    const mime = sniffDocumentType(file.buffer);
    if (!mime) {
      throw new AppError(
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        'UNSUPPORTED_FILE',
        'Only JPEG, PNG or PDF files are accepted.',
      );
    }
    if (PASSENGER_VISIBLE_PHOTOS.includes(body.type) && mime === 'application/pdf') {
      throw new AppError(
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        'PHOTO_REQUIRED',
        'This needs a photo (JPEG or PNG), not a PDF.',
      );
    }
    if (VEHICLE_DOCUMENTS.includes(body.type) && !body.vehicleId) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'VEHICLE_REQUIRED',
        'Choose the vehicle this document belongs to.',
      );
    }
    if (body.vehicleId) {
      const owns = await this.db
        .selectFrom('vehicles')
        .select('id')
        .where('id', '=', body.vehicleId)
        .where('driver_id', '=', user.id)
        .executeTakeFirst();
      if (!owns) throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Vehicle not found.');
    }

    // Random key: reveals nothing about the driver or document and can't be guessed.
    const key = `driver-documents/${user.id}/${randomUUID()}`;
    await this.storage.put(key, file.buffer, mime);
    try {
      return await this.db
        .insertInto('driver_documents')
        .values({
          driver_id: user.id,
          vehicle_id: body.vehicleId ?? null,
          type: body.type,
          storage_key: key,
          mime_type: mime,
          size_bytes: file.size,
          sha256: createHash('sha256').update(file.buffer).digest('hex'),
          reviewed_by: null,
          reviewed_at: null,
          rejection_reason: null,
          expires_on: body.expiresOn ?? null,
        })
        .returning(['id', 'type', 'status', 'mime_type'])
        .executeTakeFirstOrThrow();
    } catch (err) {
      await this.storage.remove(key); // don't leave orphaned files behind
      throw err;
    }
  }

  @Get('eligibility')
  async eligibilityStatus(@CurrentUser() user: AuthUser) {
    return this.eligibility.evaluate(user.id);
  }

  /** The driver's own subscription history and the currently active period, if any. */
  @Get('subscriptions')
  async subscriptions(@CurrentUser() user: AuthUser) {
    const rows = await this.db
      .selectFrom('subscriptions as s')
      .innerJoin('subscription_plans as p', 'p.id', 's.plan_id')
      .select(['s.id', 's.status', 's.starts_at', 's.ends_at', 'p.name as plan_name', 'p.price'])
      .where('s.driver_id', '=', user.id)
      .orderBy('s.ends_at', 'desc')
      .limit(24)
      .execute();
    const active = rows.find(
      (r) =>
        r.status === 'active' &&
        new Date(r.starts_at) <= new Date() &&
        new Date(r.ends_at) > new Date(),
    );
    return { active: active ?? null, history: rows };
  }
}
