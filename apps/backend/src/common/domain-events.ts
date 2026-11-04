import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import type { TripStatus } from '../database/types';

/**
 * In-process events between modules (e.g. matching → realtime gateway → push notifications).
 * Always emitted AFTER the database transaction commits, so listeners never see uncommitted data.
 * Single backend instance for the pilot (ADR-005); with several instances this becomes Redis pub/sub.
 */
export interface DomainEventMap {
  'offer.created': { offerId: string; tripId: string; driverId: string; expiresAt: Date };
  'offer.closed': {
    tripId: string;
    driverIds: string[];
    reason: 'taken' | 'expired' | 'cancelled';
  };
  'trip.updated': {
    tripId: string;
    passengerId: string;
    driverId: string | null;
    status: TripStatus;
  };
  'driver.location': {
    tripId: string;
    passengerId: string;
    lat: number;
    lng: number;
    recordedAt: Date;
  };
}

@Injectable()
export class DomainEvents {
  private readonly emitter = new EventEmitter();
  private readonly logger = new Logger(DomainEvents.name);

  emit<K extends keyof DomainEventMap>(event: K, payload: DomainEventMap[K]): void {
    // A failing listener must never break the request that caused the event.
    for (const listener of this.emitter.listeners(event)) {
      try {
        (listener as (p: DomainEventMap[K]) => void)(payload);
      } catch (err) {
        this.logger.error({ err, event }, 'Event listener failed');
      }
    }
  }

  on<K extends keyof DomainEventMap>(
    event: K,
    listener: (payload: DomainEventMap[K]) => void,
  ): () => void {
    this.emitter.on(event, listener);
    return () => this.emitter.off(event, listener);
  }
}
