import { DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { RateLimitGuard } from './common/rate-limit';
import { randomUUID } from 'node:crypto';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule } from './config/config.module';
import type { AppConfig } from './config/env';
import { DatabaseModule } from './database/database.module';
import { AdminAuthModule } from './modules/admin-auth/admin-auth.module';
import { AuthModule } from './modules/auth/auth.module';
import { DriversModule } from './modules/drivers/drivers.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { TripsModule } from './modules/trips/trips.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { FeedbackModule } from './modules/feedback/feedback.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AdminOpsModule } from './modules/admin-ops/admin-ops.module';
import { StorageModule } from './modules/storage/storage.module';
import { UsersModule } from './modules/users/users.module';
import { HealthController } from './modules/health/health.controller';

/** Fields that must never appear in logs. */
export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.code',
  '*.otp',
  '*.password',
  '*.refreshToken',
  '*.accessToken',
  '*.token',
];

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(config),
        LoggerModule.forRoot({
          pinoHttp: {
            level: config.NODE_ENV === 'test' ? 'silent' : config.LOG_LEVEL,
            redact: { paths: LOG_REDACT_PATHS, censor: '[REDACTED]' },
            genReqId: (req) => {
              // Accept a client request id only if it looks safe; otherwise generate one.
              const incoming = req.headers['x-request-id'];
              return typeof incoming === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(incoming)
                ? incoming
                : randomUUID();
            },
            transport: config.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
          },
        }),
        DatabaseModule,
        AuthModule,
        AdminAuthModule,
        StorageModule,
        UsersModule,
        DriversModule,
        PricingModule,
        SubscriptionsModule,
        TripsModule,
        PaymentsModule,
        FeedbackModule,
        RealtimeModule,
        NotificationsModule,
        AdminOpsModule,
      ],
      controllers: [HealthController],
      providers: [{ provide: APP_GUARD, useClass: RateLimitGuard }],
    };
  }
}
