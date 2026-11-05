import { Global, Module } from '@nestjs/common';
import { AccountService } from './account.service';
import { AccountController } from './account.controller';
import { PassengerController } from './passenger.controller';
import { RetentionService } from './retention.service';

@Global()
@Module({
  controllers: [PassengerController, AccountController],
  providers: [AccountService, RetentionService],
  exports: [AccountService, RetentionService],
})
export class UsersModule {}
