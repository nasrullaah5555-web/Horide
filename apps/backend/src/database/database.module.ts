import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { Kysely } from 'kysely';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/env';
import { createDatabase } from './database';
import type { DB } from './types';

/** Injection token for the Kysely database handle. */
export const DATABASE = Symbol('DATABASE');

@Global()
@Module({
  providers: [
    {
      provide: DATABASE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        createDatabase({
          connectionString: config.DATABASE_URL,
          ssl: config.DATABASE_SSL,
          maxConnections: config.DATABASE_POOL_MAX,
        }),
    },
  ],
  exports: [DATABASE],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  /** Closes the connection pool cleanly when the server stops. */
  async onApplicationShutdown(): Promise<void> {
    await this.db.destroy();
  }
}
