import { Inject, Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { geoPoint, type LatLng } from '../../common/geo';
import { DATABASE } from '../../database/database.module';
import type { DB } from '../../database/types';

@Injectable()
export class ZonesService {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  /** Returns the id of an active service zone containing the point, or null if outside all of them. */
  async zoneFor(point: LatLng): Promise<string | null> {
    const row = await this.db
      .selectFrom('service_zones')
      .select('id')
      .where('active', '=', true)
      .where(sql<boolean>`ST_Covers(area, ${geoPoint(point)})`)
      .executeTakeFirst();
    return row?.id ?? null;
  }
}
