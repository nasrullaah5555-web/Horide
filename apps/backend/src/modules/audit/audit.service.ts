import { Injectable } from '@nestjs/common';
import { Kysely, Transaction } from 'kysely';
import type { ActorType, DB } from '../../database/types';

export interface AuditEntry {
  actorType: ActorType;
  actorId: string | null;
  action: string; // e.g. "admin.created", "driver.approved"
  entityType: string;
  entityId: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

/**
 * Writes to the append-only audit log. Always pass the same transaction as the change being
 * audited, so a change and its audit record are saved together or not at all.
 */
@Injectable()
export class AuditService {
  async record(db: Kysely<DB> | Transaction<DB>, e: AuditEntry): Promise<void> {
    await db
      .insertInto('audit_logs')
      .values({
        actor_type: e.actorType,
        actor_id: e.actorId,
        action: e.action,
        entity_type: e.entityType,
        entity_id: e.entityId,
        before: e.before === undefined ? null : JSON.stringify(e.before),
        after: e.after === undefined ? null : JSON.stringify(e.after),
        ip: e.ip ?? null,
      })
      .execute();
  }
}
