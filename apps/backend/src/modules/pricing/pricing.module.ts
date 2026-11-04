import { Global, Module } from '@nestjs/common';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/env';
import {
  NotConfiguredRouting,
  ROUTING_PROVIDER,
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
      useFactory: (config: AppConfig) =>
        config.ROUTING_PROVIDER === 'dev_estimate' || config.ROUTING_PROVIDER === 'fake'
          ? new StraightLineEstimateRouting()
          : new NotConfiguredRouting(config.ROUTING_PROVIDER),
    },
  ],
  exports: [PricingService, ZonesService, ROUTING_PROVIDER],
})
export class PricingModule {}
