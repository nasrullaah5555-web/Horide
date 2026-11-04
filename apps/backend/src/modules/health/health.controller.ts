import { Controller, Get, HttpCode, Inject, ServiceUnavailableException } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { DATABASE } from '../../database/database.module';
import type { DB } from '../../database/types';

/**
 * Health check used by the hosting platform to decide whether this instance can take traffic.
 * It reveals nothing about versions or configuration.
 */
@Controller('health')
export class HealthController {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  @Get()
  @HttpCode(200)
  async check(): Promise<{ status: 'ok'; database: 'up' }> {
    try {
      await sql`SELECT 1`.execute(this.db);
    } catch {
      throw new ServiceUnavailableException({
        code: 'DATABASE_UNAVAILABLE',
        message: 'Database is not reachable.',
      });
    }
    return { status: 'ok', database: 'up' };
  }
}
