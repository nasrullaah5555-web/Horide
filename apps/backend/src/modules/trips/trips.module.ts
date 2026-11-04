import { Global, Module } from '@nestjs/common';
import { DomainEvents } from '../../common/domain-events';
import { LocationsController } from '../locations/locations.controller';
import { DestinationChangeService } from './destination-change.service';
import { MatchingService } from './matching.service';
import { TripViewsService } from './trip-views.service';
import { TripsController } from './trips.controller';
import { TripsService } from './trips.service';

@Global()
@Module({
  controllers: [TripsController, LocationsController],
  providers: [
    DomainEvents,
    MatchingService,
    TripsService,
    TripViewsService,
    DestinationChangeService,
  ],
  exports: [DomainEvents, MatchingService, TripsService, TripViewsService],
})
export class TripsModule {}
