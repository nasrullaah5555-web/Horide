import { Global, Module } from '@nestjs/common';
import { AccountService } from './account.service';
import { PassengerController } from './passenger.controller';

@Global()
@Module({
  controllers: [PassengerController],
  providers: [AccountService],
  exports: [AccountService],
})
export class UsersModule {}
