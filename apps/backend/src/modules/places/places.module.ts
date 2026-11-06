import {
  Controller,
  Get,
  HttpStatus,
  Inject,
  Logger,
  Module,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '../../common/errors';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/env';
import { Roles, UserAuthGuard } from '../auth/auth.guard';
import {
  DevPlaces,
  GooglePlaces,
  PhotonPlaces,
  PLACES_PROVIDER,
  type PlacesProvider,
  PlacesUnavailableError,
  photonUserAgent,
} from './places.provider';

const coord = (min: number, max: number) => z.coerce.number().min(min).max(max);
// Session tokens let Google bill one search as one session; any random string from the app.
const session = z
  .string()
  .regex(/^[A-Za-z0-9_-]{8,64}$/)
  .optional();

const searchSchema = z.strictObject({
  q: z.string().trim().min(2).max(100),
  lat: coord(-90, 90).optional(),
  lng: coord(-180, 180).optional(),
  session,
});
const detailsSchema = z.strictObject({ id: z.string().min(3).max(320), session });
const reverseSchema = z.strictObject({ lat: coord(-90, 90), lng: coord(-180, 180) });

@Controller('places')
@UseGuards(UserAuthGuard)
@Roles('passenger', 'driver')
export class PlacesController {
  private readonly log = new Logger('Places');
  constructor(@Inject(PLACES_PROVIDER) private readonly places: PlacesProvider) {}

  private async safely<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (err) {
      if (err instanceof PlacesUnavailableError) {
        this.log.warn(err.message);
        throw new AppError(
          HttpStatus.SERVICE_UNAVAILABLE,
          'PLACES_UNAVAILABLE',
          'Place search is not available right now. Move the map pin instead.',
        );
      }
      throw err;
    }
  }

  @Get('search')
  search(@Query(new ZodValidationPipe(searchSchema)) q: z.infer<typeof searchSchema>) {
    const near = q.lat !== undefined && q.lng !== undefined ? { lat: q.lat, lng: q.lng } : null;
    return this.safely(async () => ({
      places: await this.places.search(q.q, near, q.session ?? null),
    }));
  }

  @Get('details')
  details(@Query(new ZodValidationPipe(detailsSchema)) q: z.infer<typeof detailsSchema>) {
    return this.safely(() => this.places.details(q.id, q.session ?? null));
  }

  @Get('reverse')
  reverse(@Query(new ZodValidationPipe(reverseSchema)) q: z.infer<typeof reverseSchema>) {
    return this.safely(async () => ({ name: await this.places.reverse(q) }));
  }
}

@Module({
  controllers: [PlacesController],
  providers: [
    {
      provide: PLACES_PROVIDER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): PlacesProvider => {
        switch (config.PLACES_PROVIDER) {
          case 'google':
            return new GooglePlaces(config.PLACES_GOOGLE_API_KEY!);
          case 'photon':
            return new PhotonPlaces(
              config.PLACES_PHOTON_URL,
              fetch,
              photonUserAgent(config.PUBLIC_WEB_URL),
            );
          default:
            return new DevPlaces();
        }
      },
    },
  ],
  exports: [PLACES_PROVIDER],
})
export class PlacesModule {}
