import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/env';
import { DATABASE } from '../../database/database.module';
import type { DB } from '../../database/types';

/** Retention periods (SECURITY_PLAN §6). Final periods are an owner/legal decision (OA-07). */
export const RETENTION = {
  tripLocationsDays: 180,
  otpChallengesDays: 30,
  /** Sessions that ended (expired or revoked) more than this many days ago. */
  endedSessionsDays: 30,
} as const;

const RUN_EVERY_MS = 60 * 60 * 1000;

/** Deletes personal data that is no longer needed, once an hour. */
@Injectable()
export class RetentionService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RetentionService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    if (this.config.NODE_ENV === 'test') return; // tests call purge() directly
    this.timer = setInterval(() => {
      this.purge().catch((err: unknown) => this.logger.error({ err }, 'Retention purge failed'));
    }, RUN_EVERY_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async purge(
    now: Date = new Date(),
  ): Promise<{ tripLocations: number; otp: number; sessions: number }> {
    const days = (n: number) => sql<Date>`${now}::timestamptz - make_interval(days => ${n})`;
    const tripLocations = await this.db
      .deleteFrom('trip_locations')
      .where('recorded_at', '<', days(RETENTION.tripLocationsDays))
      .executeTakeFirst();
    const otp = await this.db
      .deleteFrom('otp_challenges')
      .where('created_at', '<', days(RETENTION.otpChallengesDays))
      .executeTakeFirst();
    // replaced_by points at newer sessions in the same family, so clear links to rows being removed first.
    const cutoff = days(RETENTION.endedSessionsDays);
    await this.db
      .updateTable('auth_sessions')
      .set({ replaced_by: null })
      .where('replaced_by', 'in', (q) =>
        q
          .selectFrom('auth_sessions')
          .select('id')
          .where((eb) => eb.or([eb('expires_at', '<', cutoff), eb('revoked_at', '<', cutoff)])),
      )
      .execute();
    const sessions = await this.db
      .deleteFrom('auth_sessions')
      .where((eb) => eb.or([eb('expires_at', '<', cutoff), eb('revoked_at', '<', cutoff)]))
      .executeTakeFirst();
    const result = {
      tripLocations: Number(tripLocations.numDeletedRows),
      otp: Number(otp.numDeletedRows),
      sessions: Number(sessions.numDeletedRows),
    };
    if (result.tripLocations + result.otp + result.sessions > 0) {
      this.logger.log(result, 'Retention purge removed old personal data');
    }
    return result;
  }
}
