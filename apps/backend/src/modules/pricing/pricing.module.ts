import { Global, Module } from '@nestjs/common';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/env';
import {
  GoogleRoutesRouting,
  OsrmRouting,
  ROUTING_PROVIDER,
  type RoutingProvider,
  StraightLineEstimateRouting,
} from '../geo/routing.provider';
import { ZonesService } from '../geo/zones.service';
import { PricingController } from './pricing.controller';
import { PricingService } from './pricing.service';

@Global()
@Module({
  controllers: [PricingController],
  providers: [
    PricingService,
    ZonesService,
    {
      provide: ROUTING_PROVIDER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): RoutingProvider => {
        switch (config.ROUTING_PROVIDER) {
          case 'google':
            return new GoogleRoutesRouting(config.ROUTING_GOOGLE_API_KEY!);
          case 'osrm':
            return new OsrmRouting(config.ROUTING_OSRM_URL!);
          default:
            return new StraightLineEstimateRouting();
        }
      },
    },
  ],
  exports: [PricingService, ZonesService, ROUTING_PROVIDER],
})
export class PricingModule {}
