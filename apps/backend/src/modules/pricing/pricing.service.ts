import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { Kysely } from 'kysely';
import { AppError } from '../../common/errors';
import { haversineMetres, type LatLng } from '../../common/geo';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/env';
import { DATABASE } from '../../database/database.module';
import type { DB, PaymentMethod, VehicleCategory } from '../../database/types';
import {
  NoRouteError,
  type Route,
  ROUTING_PROVIDER,
  type RoutingProvider,
  RoutingUnavailableError,
} from '../geo/routing.provider';
import { ZonesService } from '../geo/zones.service';
import { calculateFare, formatEtb } from './fare-engine';
import { signQuote, type QuotePayload } from './quote-token';

export const QUOTE_TTL_SECONDS = 300;
/** Trips shorter than this are refused: almost always a mis-placed pin. */
export const MIN_TRIP_METRES = 200;
/** A route more than this many times the straight-line distance suggests a routing error. */
const MAX_ROUTE_DETOUR_FACTOR = 4;

export interface Quote {
  category: VehicleCategory;
  fare: string; // santim
  fareEtb: string; // "123.00", display only
  distanceMetres: number;
  durationSeconds: number;
  isEstimate: boolean;
  minimumApplied: boolean;
  fareVersionId: string;
  expiresAt: Date;
  quoteToken: string;
}

export interface CurrentRates {
  versionId: string;
  baseFare: bigint;
  perKm: bigint;
  minimumFare: bigint;
  roundingUnit: bigint;
  cancellationFee: bigint;
  waitingPerMin: bigint;
  freeWaitingMinutes: number;
}

@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(ROUTING_PROVIDER) private readonly routing: RoutingProvider,
    private readonly zones: ZonesService,
  ) {}

  async currentRates(category: VehicleCategory): Promise<CurrentRates> {
    const row = await this.db
      .selectFrom('fare_settings as s')
      .innerJoin('fare_versions as v', 'v.id', 's.current_version_id')
      .select([
        'v.id',
        'v.base_fare',
        'v.per_km',
        'v.minimum_fare',
        'v.rounding_unit',
        'v.cancellation_fee',
        'v.waiting_per_min',
        'v.free_waiting_minutes',
      ])
      .where('s.category', '=', category)
      .executeTakeFirst();
    if (!row) {
      throw new AppError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'PRICING_NOT_CONFIGURED',
        `Prices for ${category} are not set yet.`,
      );
    }
    return {
      versionId: row.id,
      baseFare: BigInt(row.base_fare),
      perKm: BigInt(row.per_km),
      minimumFare: BigInt(row.minimum_fare),
      roundingUnit: BigInt(row.rounding_unit),
      cancellationFee: BigInt(row.cancellation_fee),
      waitingPerMin: BigInt(row.waiting_per_min),
      freeWaitingMinutes: row.free_waiting_minutes,
    };
  }

  /** Validates the places, gets the road route once, and prices it for each requested category. */
  async quote(input: {
    passengerId: string;
    pickup: LatLng;
    destination: LatLng;
    pickupText?: string;
    destinationText?: string;
    categories: VehicleCategory[];
    paymentMethod: PaymentMethod;
  }): Promise<Quote[]> {
    const route = await this.validatedRoute(input.pickup, input.destination);

    const expSeconds = Math.floor(Date.now() / 1000) + QUOTE_TTL_SECONDS;
    const quotes: Quote[] = [];
    for (const category of [...new Set(input.categories)]) {
      const rates = await this.currentRates(category);
      const fare = calculateFare(route.distanceMetres, rates);
      const payload: QuotePayload = {
        v: 1,
        pid: input.passengerId,
        cat: category,
        pay: input.paymentMethod,
        pu: [input.pickup.lat, input.pickup.lng],
        de: [input.destination.lat, input.destination.lng],
        ...(input.pickupText ? { put: input.pickupText } : {}),
        ...(input.destinationText ? { det: input.destinationText } : {}),
        dm: route.distanceMetres,
        ds: route.durationSeconds,
        est: route.isEstimate,
        fv: rates.versionId,
        fare: fare.total.toString(),
        exp: expSeconds,
      };
      quotes.push({
        category,
        fare: fare.total.toString(),
        fareEtb: formatEtb(fare.total),
        distanceMetres: route.distanceMetres,
        durationSeconds: route.durationSeconds,
        isEstimate: route.isEstimate,
        minimumApplied: fare.minimumApplied,
        fareVersionId: rates.versionId,
        expiresAt: new Date(expSeconds * 1000),
        quoteToken: signQuote(payload, this.config.QUOTE_SIGNING_SECRET),
      });
    }
    return quotes;
  }

  /**
   * The checks every priced journey must pass: both ends in an active service zone, not too short,
   * and a believable road route. Used for new bookings and for destination changes.
   */
  async validatedRoute(pickup: LatLng, destination: LatLng): Promise<Route> {
    const input = { pickup, destination };
    const [pickupZone, destinationZone] = await Promise.all([
      this.zones.zoneFor(input.pickup),
      this.zones.zoneFor(input.destination),
    ]);
    if (!pickupZone) {
      throw new AppError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'PICKUP_OUTSIDE_SERVICE_AREA',
        'Musride is not available at this pickup point yet.',
      );
    }
    if (!destinationZone) {
      throw new AppError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'DESTINATION_OUTSIDE_SERVICE_AREA',
        'This destination is outside the Musride service area.',
      );
    }
    const straight = haversineMetres(input.pickup, input.destination);
    if (straight < MIN_TRIP_METRES) {
      throw new AppError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'TRIP_TOO_SHORT',
        'Pickup and destination are too close together.',
      );
    }

    let route: Route;
    try {
      route = await this.routing.route(input.pickup, input.destination);
    } catch (err) {
      if (err instanceof NoRouteError) {
        throw new AppError(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'NO_ROUTE',
          'There is no road route between these points. Move the pin to a road.',
        );
      }
      if (err instanceof RoutingUnavailableError) {
        this.logger.error({ err: String(err) }, 'Routing provider unavailable');
        throw new AppError(
          HttpStatus.SERVICE_UNAVAILABLE,
          'ROUTING_UNAVAILABLE',
          'Prices are unavailable right now. Please try again in a moment.',
        );
      }
      throw err;
    }
    if (
      route.distanceMetres < straight * 0.95 ||
      route.distanceMetres > straight * MAX_ROUTE_DETOUR_FACTOR + 2000
    ) {
      // A road route can't be shorter than a straight line; a huge detour suggests bad routing data.
      throw new AppError(
        HttpStatus.BAD_GATEWAY,
        'ROUTE_UNAVAILABLE',
        'We could not find a route. Try moving the pin slightly.',
      );
    }

    return route;
  }

  /** Prices a distance with a specific (possibly older) fare version, e.g. the one locked on a trip. */
  async priceWithVersion(fareVersionId: string, distanceMetres: number): Promise<bigint> {
    const v = await this.db
      .selectFrom('fare_versions')
      .select(['base_fare', 'per_km', 'minimum_fare', 'rounding_unit'])
      .where('id', '=', fareVersionId)
      .executeTakeFirstOrThrow();
    return calculateFare(distanceMetres, {
      baseFare: BigInt(v.base_fare),
      perKm: BigInt(v.per_km),
      minimumFare: BigInt(v.minimum_fare),
      roundingUnit: BigInt(v.rounding_unit),
    }).total;
  }
}
