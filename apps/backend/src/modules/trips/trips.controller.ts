import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../common/errors';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { type AuthUser, CurrentUser, Roles, UserAuthGuard } from '../auth/auth.guard';
import { TripViewsService } from './trip-views.service';
import { TripsService } from './trips.service';

const requestSchema = z.strictObject({ quoteToken: z.string().min(20).max(4000) });
const cancelSchema = z.strictObject({ reason: z.string().trim().max(300).optional() });
const historySchema = z.strictObject({
  before: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

@Controller()
@UseGuards(UserAuthGuard)
export class TripsController {
  constructor(
    private readonly trips: TripsService,
    private readonly views: TripViewsService,
  ) {}

  /** Book a ride. 201 when created, 200 when the same quote was already used (safe retry). */
  @Post('trips')
  @Roles('passenger')
  async request(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(requestSchema)) body: z.infer<typeof requestSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { tripId, created } = await this.trips.request(user.id, body.quoteToken);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return this.views.forUser(tripId, user);
  }

  /** After reconnecting, apps call this to get the true current state. */
  @Get('trips/active')
  @Roles('passenger', 'driver')
  async active(@CurrentUser() user: AuthUser) {
    const id = await this.views.activeTripId(user);
    return { trip: id ? await this.views.forUser(id, user) : null };
  }

  @Get('trips')
  @Roles('passenger', 'driver')
  async history(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(historySchema)) q: z.infer<typeof historySchema>,
  ) {
    return { trips: await this.views.history(user, q.before, q.limit) };
  }

  @Get('trips/:id')
  @Roles('passenger', 'driver')
  async get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const view = await this.views.forUser(id, user);
    if (!view) throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Trip not found.');
    return view;
  }

  @Get('trips/:id/driver-location')
  @Roles('passenger')
  async driverLocation(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const view = await this.views.forUser(id, user);
    if (!view) throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Trip not found.');
    return { location: view.driverLocation ?? null };
  }

  @Post('trips/:id/cancel')
  @HttpCode(200)
  @Roles('passenger', 'driver')
  async cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(cancelSchema)) body: z.infer<typeof cancelSchema>,
  ) {
    await this.trips.transition(
      'cancel',
      { party: user.role, id: user.id },
      id,
      body.reason ? { reason: body.reason } : {},
    );
    return this.views.forUser(id, user);
  }

  @Get('driver/offers')
  @Roles('driver')
  async offers(@CurrentUser() user: AuthUser) {
    return { offers: await this.views.pendingOffers(user.id) };
  }

  @Post('trips/:id/accept')
  @HttpCode(200)
  @Roles('driver')
  async accept(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.trips.accept(user.id, id);
    return this.views.forUser(id, user);
  }

  @Post('trips/:id/reject')
  @HttpCode(204)
  @Roles('driver')
  async reject(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.trips.reject(user.id, id);
  }

  @Post('trips/:id/:action')
  @HttpCode(200)
  @Roles('driver')
  async driverStep(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('action') action: string,
  ) {
    const steps = {
      arriving: 'arriving',
      arrived: 'arrive',
      start: 'start',
      complete: 'complete',
    } as const;
    const step = steps[action as keyof typeof steps];
    if (!step) throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Unknown action.');
    await this.trips.transition(step, { party: 'driver', id: user.id }, id);
    return this.views.forUser(id, user);
  }
}
