import { sql } from 'kysely';
import { totpCode, totpStep } from '../src/modules/admin-auth/crypto';
import { MAX_FAILED_LOGINS } from '../src/modules/admin-auth/admin-auth.service';
import { AdminAccountsService } from '../src/modules/admin-auth/admin-accounts.service';
import { adminLogin, createTestAdmin, resetTotpReplay } from './helpers/admin';
import { startTestApp, type TestApp } from './helpers/app';

describe('Admin authentication and permissions (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await startTestApp();
  });

  afterAll(async () => {
    await t.close();
  });

  const login = (email: string, password: string, code: string) =>
    t.http().post('/admin/auth/login').send({ email, password, totpCode: code });

  describe('login', () => {
    it('sets an httpOnly, SameSite=Strict cookie and returns a CSRF token', async () => {
      const c = await createTestAdmin(t, ['support']);
      const res = await login(
        c.email,
        c.temporaryPassword,
        totpCode(c.totpSecret, totpStep()),
      ).expect(200);
      const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []).join(';');
      expect(cookie).toMatch(/musride_admin=/);
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Strict/i);
      expect(res.body.csrfToken).toMatch(/^[\w-]{40,}$/);
      // The session token itself is never in the response body.
      expect(JSON.stringify(res.body)).not.toMatch(/musride_admin/);
    });

    it('requires the TOTP code: the right password alone is not enough', async () => {
      const c = await createTestAdmin(t, ['support']);
      const res = await login(c.email, c.temporaryPassword, '000000').expect(401);
      expect(res.body.error.code).toBe('ADMIN_LOGIN_FAILED');
    });

    it('gives the same error for unknown email, wrong password and wrong code', async () => {
      const c = await createTestAdmin(t, ['support']);
      const code = totpCode(c.totpSecret, totpStep());
      const a = await login('nobody@test.local', 'whatever', code).expect(401);
      const b = await login(c.email, 'wrong-password', code).expect(401);
      expect(a.body.error).toEqual(b.body.error);
    });

    it('rejects a TOTP code that was already used (replay)', async () => {
      const c = await createTestAdmin(t, ['support']);
      const code = totpCode(c.totpSecret, totpStep());
      await login(c.email, c.temporaryPassword, code).expect(200);
      await login(c.email, c.temporaryPassword, code).expect(401);
    });

    it(`locks the account after ${MAX_FAILED_LOGINS} failures`, async () => {
      const c = await createTestAdmin(t, ['support']);
      for (let i = 0; i < MAX_FAILED_LOGINS; i++)
        await login(c.email, 'wrong', '000000').expect(401);
      const res = await login(
        c.email,
        c.temporaryPassword,
        totpCode(c.totpSecret, totpStep()),
      ).expect(429);
      expect(res.body.error.code).toBe('ADMIN_LOCKED');
      const audit = await t.db
        .selectFrom('audit_logs')
        .select('action')
        .where('entity_id', '=', c.id)
        .where('action', '=', 'admin.locked')
        .execute();
      expect(audit).toHaveLength(1);
    }, 60_000);

    it('a disabled admin cannot sign in', async () => {
      const c = await createTestAdmin(t, ['support']);
      await t.db
        .updateTable('admin_users')
        .set({ status: 'disabled' })
        .where('id', '=', c.id)
        .execute();
      await login(c.email, c.temporaryPassword, totpCode(c.totpSecret, totpStep())).expect(401);
    });

    it('stores no plain-text password or TOTP secret', async () => {
      const c = await createTestAdmin(t, ['support']);
      const row = await t.db
        .selectFrom('admin_users')
        .select(['password_hash', 'totp_secret_enc'])
        .where('id', '=', c.id)
        .executeTakeFirstOrThrow();
      expect(row.password_hash).not.toContain(c.temporaryPassword);
      expect(row.totp_secret_enc).not.toContain(c.totpSecret);
    });
  });

  describe('sessions', () => {
    it('GET /admin/auth/me works with the cookie and fails without it', async () => {
      const s = await adminLogin(t, ['finance']);
      const res = await t.http().get('/admin/auth/me').set('Cookie', s.cookie).expect(200);
      expect(res.body.roles).toEqual(['finance']);
      expect(res.body.permissions).toContain('payments.resolve');
      await t.http().get('/admin/auth/me').expect(401);
    });

    it('state-changing requests without the CSRF token are refused', async () => {
      const s = await adminLogin(t, ['support']);
      const res = await t.http().post('/admin/auth/logout').set('Cookie', s.cookie).expect(403);
      expect(res.body.error.code).toBe('CSRF_FAILED');
      await t
        .http()
        .post('/admin/auth/logout')
        .set('Cookie', s.cookie)
        .set('X-CSRF-Token', 'wrong')
        .expect(403);
      await t
        .http()
        .post('/admin/auth/logout')
        .set('Cookie', s.cookie)
        .set('X-CSRF-Token', s.csrf)
        .expect(204);
      await t.http().get('/admin/auth/me').set('Cookie', s.cookie).expect(401);
    });

    it('idle sessions expire', async () => {
      const s = await adminLogin(t, ['support']);
      await sql`UPDATE admin_sessions SET last_seen_at = now() - interval '31 minutes' WHERE admin_user_id = ${s.id}`.execute(
        t.db,
      );
      await t.http().get('/admin/auth/me').set('Cookie', s.cookie).expect(401);
    });

    it('changing the password signs out other sessions but keeps this one', async () => {
      const first = await adminLogin(t, ['support']);
      await resetTotpReplay(t, first.id);
      const secondRes = await t
        .http()
        .post('/admin/auth/login')
        .send({
          email: first.email,
          password: first.password,
          totpCode: totpCode(first.totpSecret, totpStep()),
        })
        .expect(200);
      const second = ([] as string[])
        .concat(secondRes.headers['set-cookie'] ?? [])[0]!
        .split(';')[0]!;

      await t
        .http()
        .post('/admin/auth/password')
        .set('Cookie', first.cookie)
        .set('X-CSRF-Token', first.csrf)
        .send({ currentPassword: first.password, newPassword: 'a-new-long-password-123' })
        .expect(204);
      await t.http().get('/admin/auth/me').set('Cookie', first.cookie).expect(200);
      await t.http().get('/admin/auth/me').set('Cookie', second).expect(401);
    });
  });

  describe('permissions', () => {
    it('support staff cannot manage admins or read the audit log', async () => {
      const s = await adminLogin(t, ['support']);
      await t.http().get('/admin/admins').set('Cookie', s.cookie).expect(403);
      await t.http().get('/admin/audit-logs').set('Cookie', s.cookie).expect(403);
      await t
        .http()
        .post('/admin/admins')
        .set('Cookie', s.cookie)
        .set('X-CSRF-Token', s.csrf)
        .send({ email: 'x@test.local', fullName: 'X', roles: ['super'] })
        .expect(403);
    });

    it('a super admin can create an admin, and the action is audited', async () => {
      const s = await adminLogin(t, ['super']);
      const res = await t
        .http()
        .post('/admin/admins')
        .set('Cookie', s.cookie)
        .set('X-CSRF-Token', s.csrf)
        .send({
          email: `new-${Date.now()}@test.local`,
          fullName: 'New Support',
          roles: ['support'],
        })
        .expect(201);
      expect(res.body.temporaryPassword).toHaveLength(20);
      expect(res.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);

      const logs = await t
        .http()
        .get(`/admin/audit-logs?entityType=admin_user&entityId=${res.body.id}`)
        .set('Cookie', s.cookie)
        .expect(200);
      expect(logs.body.entries.map((e: { action: string }) => e.action)).toContain('admin.created');
      expect(logs.body.entries[0].actor_id).toBe(s.id);
    });

    it('a super admin can add roles to themselves but not remove their own super role', async () => {
      const s = await adminLogin(t, ['super']);
      const res = await t
        .http()
        .put(`/admin/admins/${s.id}/roles`)
        .set('Cookie', s.cookie)
        .set('X-CSRF-Token', s.csrf)
        .send({ roles: ['support'] })
        .expect(400);
      expect(res.body.error.code).toBe('CANNOT_REMOVE_OWN_SUPER');
      await t
        .http()
        .put(`/admin/admins/${s.id}/roles`)
        .set('Cookie', s.cookie)
        .set('X-CSRF-Token', s.csrf)
        .send({ roles: ['super', 'verification', 'finance'] })
        .expect(204);
      // The new roles apply on the next request (roles are read for every request) and are audited.
      const me = await t.http().get('/admin/auth/me').set('Cookie', s.cookie).expect(200);
      expect(me.body.roles.sort()).toEqual(['finance', 'super', 'verification']);
      const audit = await t.db
        .selectFrom('audit_logs')
        .select(['actor_id', 'entity_id'])
        .where('action', '=', 'admin.roles_changed')
        .where('entity_id', '=', s.id)
        .execute();
      expect(audit).toEqual([{ actor_id: s.id, entity_id: s.id }]);
    });

    it('a super admin cannot disable themselves', async () => {
      const s = await adminLogin(t, ['super']);
      await t
        .http()
        .post(`/admin/admins/${s.id}/disable`)
        .set('Cookie', s.cookie)
        .set('X-CSRF-Token', s.csrf)
        .expect(400);
    });

    it('disabling an admin ends their sessions immediately', async () => {
      const boss = await adminLogin(t, ['super']);
      const staff = await adminLogin(t, ['support']);
      await t
        .http()
        .post(`/admin/admins/${staff.id}/disable`)
        .set('Cookie', boss.cookie)
        .set('X-CSRF-Token', boss.csrf)
        .expect(204);
      await t.http().get('/admin/auth/me').set('Cookie', staff.cookie).expect(401);
    });

    it('changing roles is audited with before and after', async () => {
      const boss = await adminLogin(t, ['super']);
      const staff = await createTestAdmin(t, ['support']);
      await t
        .http()
        .put(`/admin/admins/${staff.id}/roles`)
        .set('Cookie', boss.cookie)
        .set('X-CSRF-Token', boss.csrf)
        .send({ roles: ['support', 'finance'] })
        .expect(204);
      const entry = await t.db
        .selectFrom('audit_logs')
        .select(['before', 'after'])
        .where('entity_id', '=', staff.id)
        .where('action', '=', 'admin.roles_changed')
        .executeTakeFirstOrThrow();
      expect(entry.before).toEqual({ roles: ['support'] });
      expect(entry.after).toEqual({ roles: ['support', 'finance'] });
    });

    it('a user (passenger) token cannot reach admin endpoints', async () => {
      await t.http().get('/admin/auth/me').set('Authorization', 'Bearer something').expect(401);
    });
  });
});

describe('Staging staff password reset (e2e)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startTestApp();
  });
  afterAll(() => t.close());

  const login = (email: string, password: string, code: string) =>
    t.http().post('/admin/auth/login').send({ email, password, totpCode: code });

  it('gives a new password once per word, unlocks, signs out, keeps the authenticator', async () => {
    const accounts = t.app.get(AdminAccountsService);
    const c = await createTestAdmin(t, ['super']);
    // A session that must end, and a lock from failed tries that must lift.
    await login(c.email, c.temporaryPassword, totpCode(c.totpSecret, totpStep())).expect(200);
    await t.db
      .updateTable('admin_users')
      .set({ failed_login_count: 9, locked_until: new Date(Date.now() + 3_600_000) })
      .where('email', '=', c.email)
      .execute();

    const word = `reset-${Date.now()}`;
    const fresh = await accounts.resetPasswordForStaging(c.email.toUpperCase(), word);
    expect(fresh).toMatch(/^[\w-]{20}$/);
    // Same word again (a restart with the setting still there): nothing changes.
    expect(await accounts.resetPasswordForStaging(c.email, word)).toBeNull();
    // Unknown account: nothing happens.
    expect(await accounts.resetPasswordForStaging('nobody@test.local', `${word}-x`)).toBeNull();

    const open = await t.db
      .selectFrom('admin_sessions as s')
      .innerJoin('admin_users as u', 'u.id', 's.admin_user_id')
      .select('s.id')
      .where('u.email', '=', c.email)
      .where('s.revoked_at', 'is', null)
      .execute();
    expect(open).toHaveLength(0);

    await resetTotpReplay(t, c.id);
    await login(c.email, c.temporaryPassword, totpCode(c.totpSecret, totpStep())).expect(401);
    await resetTotpReplay(t, c.id);
    await login(c.email, fresh!, totpCode(c.totpSecret, totpStep())).expect(200);

    const audit = await t.db
      .selectFrom('audit_logs')
      .select(['actor_type', 'after'])
      .where('action', '=', 'admin.password_reset_staging')
      .where('entity_id', '=', c.id)
      .execute();
    expect(audit).toHaveLength(1);
    // The word itself is never stored, only its hash.
    expect(JSON.stringify(audit)).not.toContain(word);
  });
});
