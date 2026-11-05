import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Kysely } from 'kysely';
import { DomainEvents } from '../../common/domain-events';
import { DATABASE } from '../../database/database.module';
import type { DB, TripStatus } from '../../database/types';
import { PUSH_PROVIDER, type PushProvider } from './push.provider';

interface NotificationInput {
  type: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

/** What each party is told when a trip changes. Short, plain English (v1 language). */
const TRIP_MESSAGES: Partial<
  Record<TripStatus, { passenger?: NotificationInput; driver?: NotificationInput }>
> = {
  accepted: {
    passenger: { type: 'trip.accepted', title: 'Driver found', body: 'Your driver is on the way.' },
  },
  arrived: {
    passenger: {
      type: 'trip.arrived',
      title: 'Your driver has arrived',
      body: 'Please meet your driver at the pickup point.',
    },
  },
  completed: {
    passenger: {
      type: 'trip.completed',
      title: 'Trip completed',
      body: 'Please pay your driver and rate your trip.',
    },
    driver: {
      type: 'trip.completed',
      title: 'Trip completed',
      body: 'Record the payment you received.',
    },
  },
  expired: {
    passenger: {
      type: 'trip.expired',
      title: 'No driver available',
      body: 'No driver accepted your request. Please try again.',
    },
  },
  cancelled: {
    passenger: {
      type: 'trip.cancelled',
      title: 'Trip cancelled',
      body: 'Your trip was cancelled.',
    },
    driver: { type: 'trip.cancelled', title: 'Trip cancelled', body: 'The trip was cancelled.' },
  },
};

/**
 * Stores notifications for the in-app list and sends them as push notifications.
 * A push failure never breaks the action that caused it; the stored notification remains.
 */
@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsService.name);
  private unsubscribers: (() => void)[] = [];

  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    @Inject(PUSH_PROVIDER) private readonly push: PushProvider,
    private readonly events: DomainEvents,
  ) {}

  onModuleInit(): void {
    this.unsubscribers = [
      this.events.on('trip.updated', (e) => {
        const messages = TRIP_MESSAGES[e.status];
        if (!messages) return;
        const data = { tripId: e.tripId, status: e.status };
        if (messages.passenger) void this.notify(e.passengerId, { ...messages.passenger, data });
        if (messages.driver && e.driverId)
          void this.notify(e.driverId, { ...messages.driver, data });
      }),
      // New ride offers: push only (they expire in seconds, so they don't belong in the inbox).
      this.events.on('offer.created', (e) => {
        void this.pushOnly(e.driverId, {
          title: 'New ride request',
          body: 'Open Horide to accept.',
          data: { type: 'offer.created', tripId: e.tripId, expiresAt: e.expiresAt.toISOString() },
        });
      }),
    ];
  }

  onModuleDestroy(): void {
    for (const off of this.unsubscribers) off();
  }

  async notify(userId: string, n: NotificationInput): Promise<void> {
    try {
      await this.db
        .insertInto('notifications')
        .values({
          user_id: userId,
          type: n.type,
          title: n.title,
          body: n.body,
          data: n.data ? JSON.stringify(n.data) : null,
          read_at: null,
        })
        .execute();
      await this.pushOnly(userId, {
        title: n.title,
        body: n.body,
        data: { type: n.type, ...(n.data ?? {}) },
      });
    } catch (err) {
      this.logger.error({ err, userId, type: n.type }, 'Failed to create notification');
    }
  }

  private async pushOnly(
    userId: string,
    message: { title: string; body: string; data: Record<string, string> },
  ): Promise<void> {
    try {
      const tokens = await this.db
        .selectFrom('device_tokens')
        .select('fcm_token')
        .where('user_id', '=', userId)
        .execute();
      if (tokens.length === 0) return;
      const { invalidTokens } = await this.push.send(
        tokens.map((t) => t.fcm_token),
        message,
      );
      if (invalidTokens.length) {
        // The app was uninstalled or the token replaced: stop sending to it.
        await this.db.deleteFrom('device_tokens').where('fcm_token', 'in', invalidTokens).execute();
      }
    } catch (err) {
      this.logger.warn({ err, userId }, 'Push delivery failed');
    }
  }
}
