import { Inject, Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { DATABASE } from '../../database/database.module';
import type { DB, VehicleCategory } from '../../database/types';
import { REQUIRED_DRIVER_DOCUMENTS } from './driver-requirements';

export type IneligibleReason =
  | 'ACCOUNT_SUSPENDED'
  | 'ACCOUNT_DELETED'
  | 'DRIVER_NOT_APPROVED'
  | 'NO_APPROVED_VEHICLE'
  | 'SUBSCRIPTION_INACTIVE';

export interface Eligibility {
  eligible: boolean;
  reasons: IneligibleReason[];
  vehicle: { id: string; category: VehicleCategory } | null;
  subscriptionEndsAt: Date | null;
  missingDocuments: string[];
}

/**
 * The single definition of "may this driver receive NEW ride offers?" (business rule BR-04).
 * Matching uses the same rules in SQL. Note: this is checked only before NEW offers and accepts;
 * it never interrupts a trip already accepted or in progress (BR-05).
 */
@Injectable()
export class DriverEligibilityService {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  async evaluate(driverId: string): Promise<Eligibility> {
    const row = await this.db
      .selectFrom('users as u')
      .innerJoin('driver_profiles as d', 'd.user_id', 'u.id')
      .leftJoin('vehicles as v', (j) =>
        j
          .onRef('v.driver_id', '=', 'u.id')
          .on('v.approval_status', '=', 'approved')
          .on('v.is_active', '=', true),
      )
      .select([
        'u.status',
        'd.approval_status',
        'v.id as vehicle_id',
        'v.category',
        sql<Date | null>`(
          SELECT max(s.ends_at) FROM subscriptions s
          WHERE s.driver_id = u.id AND s.status = 'active' AND s.starts_at <= now() AND s.ends_at > now()
        )`.as('subscription_ends_at'),
      ])
      .where('u.id', '=', driverId)
      .executeTakeFirst();

    if (!row) {
      return {
        eligible: false,
        reasons: ['ACCOUNT_DELETED'],
        vehicle: null,
        subscriptionEndsAt: null,
        missingDocuments: [],
      };
    }

    const approvedDocs = await this.db
      .selectFrom('driver_documents')
      .select('type')
      .distinct()
      .where('driver_id', '=', driverId)
      .where('status', '=', 'approved')
      .execute();
    const have = new Set(approvedDocs.map((d) => d.type));
    const missingDocuments = REQUIRED_DRIVER_DOCUMENTS.filter((t) => !have.has(t));

    const reasons: IneligibleReason[] = [];
    if (row.status === 'suspended') reasons.push('ACCOUNT_SUSPENDED');
    if (row.status === 'deleted') reasons.push('ACCOUNT_DELETED');
    if (row.approval_status !== 'approved') reasons.push('DRIVER_NOT_APPROVED');
    if (!row.vehicle_id) reasons.push('NO_APPROVED_VEHICLE');
    if (!row.subscription_ends_at) reasons.push('SUBSCRIPTION_INACTIVE');

    return {
      eligible: reasons.length === 0,
      reasons,
      vehicle:
        row.vehicle_id && row.category ? { id: row.vehicle_id, category: row.category } : null,
      subscriptionEndsAt: row.subscription_ends_at,
      missingDocuments,
    };
  }
}
