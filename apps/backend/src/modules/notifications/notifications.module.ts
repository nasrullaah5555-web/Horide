import { Module } from '@nestjs/common';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/env';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { FcmPushProvider, LogPushProvider, PUSH_PROVIDER } from './push.provider';

@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    {
      provide: PUSH_PROVIDER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        config.PUSH_PROVIDER === 'log' ? new LogPushProvider() : new FcmPushProvider(),
    },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
