import { sql } from 'kysely';
import type { AdminRole } from '../../src/database/types';
import { AdminAccountsService } from '../../src/modules/admin-auth/admin-accounts.service';
import { totpCode, totpStep } from '../../src/modules/admin-auth/crypto';
import type { TestApp } from './app';

let n = 0;

export interface AdminSession {
  id: string;
  email: string;
  password: string;
  totpSecret: string;
  cookie: string;
  csrf: string;
}

export async function createTestAdmin(t: TestApp, roles: AdminRole[]) {
  n++;
  return t.app
    .get(AdminAccountsService)
    .create(
      { email: `admin${n}-${Date.now()}@test.local`, fullName: `Admin ${n}`, roles },
      { id: null },
    );
}

/** Allows another login inside the same 30-second TOTP window (tests only). */
export async function resetTotpReplay(t: TestApp, adminId: string) {
  await sql`UPDATE admin_users SET totp_last_step = NULL WHERE id = ${adminId}`.execute(t.db);
}

/** Creates an admin with the given roles and signs in through the real login endpoint. */
export async function adminLogin(t: TestApp, roles: AdminRole[]): Promise<AdminSession> {
  const creds = await createTestAdmin(t, roles);
  const res = await t
    .http()
    .post('/admin/auth/login')
    .send({
      email: creds.email,
      password: creds.temporaryPassword,
      totpCode: totpCode(creds.totpSecret, totpStep()),
    })
    .expect(200);
  const setCookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const cookie = setCookie.find((c) => c.startsWith('horide_admin='))!.split(';')[0]!;
  return {
    id: creds.id,
    email: creds.email,
    password: creds.temporaryPassword,
    totpSecret: creds.totpSecret,
    cookie,
    csrf: res.body.csrfToken,
  };
}
