import { Global, Module } from '@nestjs/common';
import { AdminDriversController } from './admin-drivers.controller';
import { DriverEligibilityService } from './driver-eligibility.service';
import { DriverController } from './driver.controller';

@Global()
@Module({
  controllers: [DriverController, AdminDriversController],
  providers: [DriverEligibilityService],
  exports: [DriverEligibilityService],
})
export class DriversModule {}
