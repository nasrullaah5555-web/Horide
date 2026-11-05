import { Module } from '@nestjs/common';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/env';
import { AuthController } from './auth.controller';
import { UserAuthGuard } from './auth.guard';
import { OtpService } from './otp.service';
import { SessionService } from './session.service';
import {
  AfroMessageSmsProvider,
  ConsoleSmsProvider,
  FakeSmsProvider,
  SMS_PROVIDER,
} from './sms/sms.provider';

@Module({
  controllers: [AuthController],
  providers: [
    OtpService,
    SessionService,
    UserAuthGuard,
    {
      provide: SMS_PROVIDER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => {
        switch (config.SMS_PROVIDER) {
          case 'console':
            return new ConsoleSmsProvider();
          case 'fake':
            return new FakeSmsProvider();
          case 'afromessage':
            return new AfroMessageSmsProvider({
              token: config.AFROMESSAGE_TOKEN!,
              ...(config.AFROMESSAGE_SENDER ? { sender: config.AFROMESSAGE_SENDER } : {}),
              ...(config.AFROMESSAGE_IDENTIFIER_ID
                ? { identifierId: config.AFROMESSAGE_IDENTIFIER_ID }
                : {}),
            });
        }
      },
    },
  ],
  exports: [UserAuthGuard, SessionService],
})
export class AuthModule {}
