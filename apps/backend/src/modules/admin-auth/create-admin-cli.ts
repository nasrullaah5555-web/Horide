import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { loadConfig } from '../../config/env';
import type { AdminRole } from '../../database/types';
import { AdminAccountsService } from './admin-accounts.service';

/**
 * Creates an admin account from the command line. Needed once, to create the first super admin
 * (there is no other admin yet who could do it through the dashboard).
 *
 *   pnpm admin:create --email you@example.com --name "Your Name" --roles super
 *
 * Prints a temporary password and the TOTP setup link ONCE. Scan the link into an authenticator
 * app (Google Authenticator, Microsoft Authenticator, Aegis…) and change the password after first login.
 */
async function main(): Promise<void> {
  const args = new Map<string, string>();
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) args.set(argv[i]!.replace(/^--/, ''), argv[i + 1] ?? '');
  const email = args.get('email');
  const name = args.get('name');
  const roles = (args.get('roles') ?? '').split(',').filter(Boolean) as AdminRole[];
  if (!email || !name || roles.length === 0) {
    throw new Error(
      'Usage: pnpm admin:create --email <email> --name "<full name>" --roles super[,finance,...]',
    );
  }

  const app = await NestFactory.createApplicationContext(AppModule.forRoot(loadConfig()), {
    logger: false,
  });
  try {
    const creds = await app
      .get(AdminAccountsService)
      .create({ email, fullName: name, roles }, { id: null });
    console.log('\nAdmin created. This information is shown ONCE — store it safely now.\n');
    console.log(`  Email:              ${creds.email}`);
    console.log(`  Temporary password: ${creds.temporaryPassword}`);
    console.log(`  Authenticator link: ${creds.otpauthUrl}`);
    console.log(`  (manual key:        ${creds.totpSecret})\n`);
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
