import 'reflect-metadata';
import { createApp } from './bootstrap';
import { Kysely } from 'kysely';
import { type AppConfig, ConfigError, loadConfig } from './config/env';
import { DATABASE } from './database/database.module';
import type { DB } from './database/types';
import { AdminAccountsService } from './modules/admin-auth/admin-accounts.service';

async function main(): Promise<void> {
  // Validate configuration before anything else starts.
  const config = loadConfig();
  const app = await createApp(config);
  await bootstrapStagingAdmin(app, config);
  await app.listen(config.PORT, '0.0.0.0');
}

/**
 * Staging only (config refuses it elsewhere): when there are no staff accounts yet, create one
 * super admin and print its one-time sign-in details to the server log. Exists because free
 * hosting plans have no shell to run the admin CLI. Production uses the CLI (DEPLOYMENT_GUIDE §3).
 */
async function bootstrapStagingAdmin(
  app: Awaited<ReturnType<typeof createApp>>,
  config: AppConfig,
): Promise<void> {
  const email = config.STAGING_BOOTSTRAP_ADMIN_EMAIL;
  if (config.NODE_ENV !== 'staging' || !email) return;
  const db = app.get<Kysely<DB>>(DATABASE);
  const existing = await db.selectFrom('admin_users').select('id').limit(1).executeTakeFirst();
  if (existing) return;
  const creds = await app
    .get(AdminAccountsService)
    .create({ email, fullName: 'Staging super admin', roles: ['super'] }, { id: null });
  console.log(
    [
      '',
      '=== STAGING: first staff account created. Shown ONCE. Change the password after sign-in. ===',
      `  Email:              ${creds.email}`,
      `  Temporary password: ${creds.temporaryPassword}`,
      `  Authenticator key:  ${creds.totpSecret}`,
      `  Authenticator link: ${creds.otpauthUrl}`,
      '',
    ].join('\n'),
  );
}

main().catch((err: unknown) => {
  // Configuration errors are expected operator mistakes: print them plainly.
  if (err instanceof ConfigError) {
    console.error(err.message);
  } else {
    console.error('Failed to start Horide API:', err);
  }
  process.exit(1);
});
