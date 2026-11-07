import {
  Controller,
  Get,
  Inject,
  Injectable,
  HttpStatus,
  Logger,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { Kysely } from 'kysely';
import sharp from 'sharp';
import { AppError } from '../../common/errors';
import { RateLimit } from '../../common/rate-limit';
import { DATABASE } from '../../database/database.module';
import type { DB, DocumentType, TripStatus } from '../../database/types';
import { type AuthUser, CurrentUser, Roles, UserAuthGuard } from '../auth/auth.guard';
import { STORAGE_PROVIDER, type StorageProvider } from '../storage/storage.provider';
import { ACTIVE_STATUSES } from './trip-state';

/** The passenger sees the photos while the driver is coming and on board, and on the receipt. */
const PHOTO_STATUSES: readonly TripStatus[] = [...ACTIVE_STATUSES, 'completed'];

/** Small enough for a weak connection, sharp enough on a phone's high-density screen. */
const SIZES = {
  profile_photo: { width: 240, height: 240 },
  vehicle_photo: { width: 480, height: 320 },
} as const;
const JPEG_QUALITY = 72;
const CACHE_LIMIT = 300;

export interface TripPhoto {
  mime: 'image/jpeg';
  /** Base64 JPEG, a few tens of kilobytes. */
  data: string;
}

/**
 * The driver's face and the car, so the passenger gets into the right vehicle (ADR-027).
 * Only photos Musride staff APPROVED are shown, only to the passenger of that trip, only as a
 * small re-encoded copy (which also drops the camera's metadata, such as where it was taken).
 * The original stays in private storage; there is still no public URL for any document.
 */
@Injectable()
export class TripPhotosService {
  private readonly log = new Logger(TripPhotosService.name);
  /** Re-encoded copies by document id. Approved documents never change, so this is safe. */
  private readonly cache = new Map<string, Buffer>();

  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  async forPassenger(
    passengerId: string,
    tripId: string,
  ): Promise<{ driver: TripPhoto | null; vehicle: TripPhoto | null }> {
    const trip = await this.db
      .selectFrom('trips')
      .select(['status', 'driver_id', 'vehicle_id'])
      .where('id', '=', tripId)
      .where('passenger_id', '=', passengerId) // ownership in the query: no IDOR
      .executeTakeFirst();
    if (!trip || !trip.driver_id || !PHOTO_STATUSES.includes(trip.status)) {
      throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Trip not found.');
    }
    const [driver, vehicle] = await Promise.all([
      this.photo('profile_photo', trip.driver_id, null),
      trip.vehicle_id ? this.photo('vehicle_photo', trip.driver_id, trip.vehicle_id) : null,
    ]);
    return { driver, vehicle };
  }

  private async photo(
    type: 'profile_photo' | 'vehicle_photo',
    driverId: string,
    vehicleId: string | null,
  ): Promise<TripPhoto | null> {
    let q = this.db
      .selectFrom('driver_documents')
      .select(['id', 'storage_key'])
      .where('driver_id', '=', driverId)
      .where('type', '=', type satisfies DocumentType)
      .where('status', '=', 'approved')
      .where('mime_type', 'in', ['image/jpeg', 'image/png']);
    if (vehicleId) q = q.where('vehicle_id', '=', vehicleId);
    const doc = await q.orderBy('reviewed_at', 'desc').limit(1).executeTakeFirst();
    if (!doc) return null;

    let small = this.cache.get(doc.id);
    if (!small) {
      try {
        const { width, height } = SIZES[type];
        small = await sharp(await this.storage.get(doc.storage_key), { failOn: 'error' })
          .rotate() // honour the camera's orientation before the metadata is dropped
          .resize(width, height, { fit: 'cover', position: 'attention' })
          .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
          .toBuffer();
      } catch (err) {
        // A broken file shows the placeholder rather than failing the whole trip screen.
        this.log.warn(`could not prepare ${type} ${doc.id}: ${String(err)}`);
        return null;
      }
      if (this.cache.size >= CACHE_LIMIT) {
        this.cache.delete(this.cache.keys().next().value!); // oldest first
      }
      this.cache.set(doc.id, small);
    }
    return { mime: 'image/jpeg', data: small.toString('base64') };
  }
}

@Controller()
@UseGuards(UserAuthGuard)
export class TripPhotosController {
  constructor(private readonly photos: TripPhotosService) {}

  @RateLimit({ name: 'trip-photos', limit: 30, windowSeconds: 60 })
  @Get('trips/:id/photos')
  @Roles('passenger')
  async get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.photos.forPassenger(user.id, id);
  }
}
