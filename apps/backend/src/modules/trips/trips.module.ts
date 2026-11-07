import { Global, Module } from '@nestjs/common';
import { DomainEvents } from '../../common/domain-events';
import { LocationsController } from '../locations/locations.controller';
import { DestinationChangeService } from './destination-change.service';
import { MatchingService } from './matching.service';
import { TripPhotosController, TripPhotosService } from './trip-photos';
import { TripSharesController, TripSharesService } from './trip-shares';
import { TripViewsService } from './trip-views.service';
import { TripsController } from './trips.controller';
import { TripsService } from './trips.service';

@Global()
@Module({
  controllers: [TripsController, LocationsController, TripSharesController, TripPhotosController],
  providers: [
    DomainEvents,
    MatchingService,
    TripsService,
    TripViewsService,
    TripSharesService,
    TripPhotosService,
    DestinationChangeService,
  ],
  exports: [DomainEvents, MatchingService, TripsService, TripViewsService],
})
export class TripsModule {}
