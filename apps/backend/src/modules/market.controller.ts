import { Controller, Get, Inject } from '@nestjs/common';
import { MARKETS } from '../common/market';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/env';

/**
 * What the apps, console and website need to look right for this city: currency, payment
 * methods, emergency numbers and where maps start. Public and contains nothing private.
 */
@Controller()
export class MarketController {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  @Get('market')
  market() {
    return MARKETS[this.config.MARKET];
  }
}
