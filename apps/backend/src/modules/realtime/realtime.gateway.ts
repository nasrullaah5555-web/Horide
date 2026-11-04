import { Inject, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { DomainEvents } from '../../common/domain-events';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/env';
import { verifyAccessToken } from '../auth/tokens';
import { TripViewsService } from '../trips/trip-views.service';

/**
 * Live updates to the apps over WebSocket (Socket.IO).
 *
 * - Authenticated at connection with the same access token as the REST API
 *   (`io(url, { auth: { token } })`). Invalid or missing token → disconnected immediately.
 * - Each user joins only their own room ("user:<id>"); there are no client-chosen rooms,
 *   so nobody can subscribe to someone else's trip.
 * - Events are hints, not the source of truth: after reconnecting, apps call GET /trips/active.
 *   This keeps the app correct even when messages are lost on a weak connection.
 */
@WebSocketGateway({ path: '/realtime', cors: { origin: false }, maxHttpBufferSize: 10_000 })
export class RealtimeGateway implements OnGatewayConnection, OnModuleInit, OnModuleDestroy {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(RealtimeGateway.name);
  private unsubscribers: (() => void)[] = [];

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly events: DomainEvents,
    private readonly views: TripViewsService,
  ) {}

  handleConnection(client: Socket): void {
    const token =
      typeof client.handshake.auth?.token === 'string' ? client.handshake.auth.token : '';
    const claims = verifyAccessToken(token, this.config.JWT_ACCESS_SECRET);
    if (!claims) {
      client.emit('error', { code: 'UNAUTHENTICATED' });
      client.disconnect(true);
      return;
    }
    client.data.userId = claims.sub;
    client.data.role = claims.role;
    void client.join(`user:${claims.sub}`);
    // Disconnect when the access token expires; the app reconnects with a refreshed token.
    const msLeft = claims.exp * 1000 - Date.now();
    const timer = setTimeout(() => client.disconnect(true), Math.max(0, msLeft));
    client.once('disconnect', () => clearTimeout(timer));
    client.emit('ready', { userId: claims.sub, role: claims.role });
  }

  onModuleInit(): void {
    const to = (userId: string) => this.server?.to(`user:${userId}`);
    this.unsubscribers = [
      this.events.on('offer.created', (e) => {
        to(e.driverId)?.emit('offer.created', {
          tripId: e.tripId,
          offerId: e.offerId,
          expiresAt: e.expiresAt,
        });
      }),
      this.events.on('offer.closed', (e) => {
        for (const id of e.driverIds)
          to(id)?.emit('offer.closed', { tripId: e.tripId, reason: e.reason });
      }),
      this.events.on('trip.updated', (e) => {
        // Send each party the view they are allowed to see (same rules as the REST API).
        void this.pushTrip(e.tripId, e.passengerId, 'passenger');
        if (e.driverId) void this.pushTrip(e.tripId, e.driverId, 'driver');
      }),
      this.events.on('driver.location', (e) => {
        to(e.passengerId)?.emit('driver.location', {
          tripId: e.tripId,
          lat: e.lat,
          lng: e.lng,
          recordedAt: e.recordedAt,
        });
      }),
    ];
  }

  onModuleDestroy(): void {
    for (const off of this.unsubscribers) off();
  }

  private async pushTrip(
    tripId: string,
    userId: string,
    role: 'passenger' | 'driver',
  ): Promise<void> {
    try {
      const view = await this.views.forUser(tripId, { id: userId, role });
      if (view) this.server?.to(`user:${userId}`).emit('trip.updated', view);
    } catch (err) {
      this.logger.warn({ err, tripId }, 'Could not push trip update');
    }
  }
}
