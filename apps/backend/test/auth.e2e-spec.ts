import { sql } from 'kysely';
import { loginAs, randomIp, startTestApp, type TestApp } from './helpers/app';
import { uniquePhone } from './helpers/fixtures';

describe('Phone OTP authentication (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await startTestApp();
  });

  afterAll(async () => {
    await t.close();
  });

  const requestCode = (phone: string, ip = randomIp()) =>
    t.http().post('/auth/otp/request').set('X-Forwarded-For', ip).send({ phone });

  /** Lets a test request another code without waiting for the real 60-second cooldown. */
  const skipCooldown = (e164: string) =>
    sql`UPDATE otp_challenges SET created_at = created_at - interval '2 minutes' WHERE phone = ${e164}`.execute(
      t.db,
    );

  describe('happy path', () => {
    it('creates a passenger on first login and the same account on the next login', async () => {
      const phone = uniquePhone();
      const first = await loginAs(t, 'passenger', phone);
      expect(first.user).toMatchObject({ role: 'passenger', phone, isNew: true });
      expect(first.accessToken).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);

      await skipCooldown(phone);
      const second = await loginAs(t, 'passenger', phone);
      expect(second.user.id).toBe(first.user.id);
      expect(second.user.isNew).toBe(false);

      const profile = await t.db
        .selectFrom('passenger_profiles')
        .select('user_id')
        .where('user_id', '=', first.user.id)
        .execute();
      expect(profile).toHaveLength(1);
    });

    it('keeps passenger and driver accounts for one phone separate', async () => {
      const phone = uniquePhone();
      const passenger = await loginAs(t, 'passenger', phone);
      await skipCooldown(phone);
      const driver = await loginAs(t, 'driver', phone);
      expect(driver.user.id).not.toBe(passenger.user.id);
      const profile = await t.db
        .selectFrom('driver_profiles')
        .select('approval_status')
        .where('user_id', '=', driver.user.id)
        .executeTakeFirstOrThrow();
      expect(profile.approval_status).toBe('pending');
    });

    it('accepts local number formats and normalises them', async () => {
      const e164 = uniquePhone();
      const local = `0${e164.slice(4)}`;
      await requestCode(local).expect(200);
      expect(t.sms.lastCodeFor(e164)).toMatch(/^\d{6}$/);
    });

    it('GET /auth/me returns only the caller', async () => {
      const a = await loginAs(t, 'passenger');
      const res = await t
        .http()
        .get('/auth/me')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .expect(200);
      expect(res.body.id).toBe(a.user.id);
    });
  });

  describe('OTP protections', () => {
    it('stores no plain-text code', async () => {
      const phone = uniquePhone();
      await requestCode(phone).expect(200);
      const code = t.sms.lastCodeFor(phone)!;
      const row = await t.db
        .selectFrom('otp_challenges')
        .select('code_hash')
        .where('phone', '=', phone)
        .executeTakeFirstOrThrow();
      expect(row.code_hash).not.toContain(code);
      expect(row.code_hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('rejects invalid numbers', async () => {
      const res = await requestCode('+254711234567').expect(400);
      expect(res.body.error.code).toBe('INVALID_PHONE');
    });

    it('rejects unknown fields (e.g. trying to set a role at request time)', async () => {
      const res = await t
        .http()
        .post('/auth/otp/request')
        .send({ phone: uniquePhone(), role: 'admin' })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('locks the code after 5 wrong attempts, even if the right code comes next', async () => {
      const phone = uniquePhone();
      const req = await requestCode(phone).expect(200);
      const code = t.sms.lastCodeFor(phone)!;
      const wrong = code === '000000' ? '111111' : '000000';
      for (let i = 0; i < 5; i++) {
        await t
          .http()
          .post('/auth/otp/verify')
          .send({ challengeId: req.body.challengeId, code: wrong, role: 'passenger' })
          .expect(401);
      }
      const res = await t
        .http()
        .post('/auth/otp/verify')
        .send({ challengeId: req.body.challengeId, code, role: 'passenger' })
        .expect(401);
      expect(res.body.error.code).toBe('OTP_INVALID');
    });

    it('a code works only once (replay protection)', async () => {
      const phone = uniquePhone();
      const req = await requestCode(phone).expect(200);
      const body = {
        challengeId: req.body.challengeId,
        code: t.sms.lastCodeFor(phone)!,
        role: 'passenger',
      };
      await t.http().post('/auth/otp/verify').send(body).expect(200);
      await t.http().post('/auth/otp/verify').send(body).expect(401);
    });

    it('an expired code is rejected', async () => {
      const phone = uniquePhone();
      const req = await requestCode(phone).expect(200);
      await sql`UPDATE otp_challenges SET expires_at = now() - interval '1 second' WHERE id = ${req.body.challengeId}`.execute(
        t.db,
      );
      await t
        .http()
        .post('/auth/otp/verify')
        .send({
          challengeId: req.body.challengeId,
          code: t.sms.lastCodeFor(phone)!,
          role: 'passenger',
        })
        .expect(401);
    });

    it('requesting a new code invalidates the previous one', async () => {
      const phone = uniquePhone();
      const first = await requestCode(phone).expect(200);
      const firstCode = t.sms.lastCodeFor(phone)!;
      await skipCooldown(phone);
      await requestCode(phone).expect(200);
      await t
        .http()
        .post('/auth/otp/verify')
        .send({ challengeId: first.body.challengeId, code: firstCode, role: 'passenger' })
        .expect(401);
    });

    it('enforces a resend cooldown', async () => {
      const phone = uniquePhone();
      await requestCode(phone).expect(200);
      const res = await requestCode(phone).expect(429);
      expect(res.body.error.code).toBe('OTP_COOLDOWN');
    });

    it('limits codes per phone per 15 minutes', async () => {
      const phone = uniquePhone();
      for (let i = 0; i < 3; i++) {
        await requestCode(phone).expect(200);
        await skipCooldown(phone);
        // keep them inside the 15-minute window
      }
      const res = await requestCode(phone).expect(429);
      expect(res.body.error.code).toBe('OTP_PHONE_LIMIT');
    });

    it('limits codes per IP address per hour', async () => {
      const ip = randomIp();
      for (let i = 0; i < 10; i++) await requestCode(uniquePhone(), ip).expect(200);
      const res = await requestCode(uniquePhone(), ip).expect(429);
      expect(res.body.error.code).toBe('OTP_IP_LIMIT');
    });

    it('gives the same answer for registered and unregistered numbers', async () => {
      const registered = uniquePhone();
      await loginAs(t, 'passenger', registered);
      await skipCooldown(registered);
      const a = await requestCode(registered).expect(200);
      const b = await requestCode(uniquePhone()).expect(200);
      expect(Object.keys(a.body).sort()).toEqual(Object.keys(b.body).sort());
    });

    it('does not leave a usable code when the SMS fails', async () => {
      const phone = uniquePhone();
      t.sms.failNext = true;
      const res = await requestCode(phone).expect(503);
      expect(res.body.error.code).toBe('SMS_UNAVAILABLE');
      const usable = await t.db
        .selectFrom('otp_challenges')
        .select('id')
        .where('phone', '=', phone)
        .where('expires_at', '>', sql<Date>`now()`)
        .execute();
      expect(usable).toHaveLength(0);
    });
  });

  describe('sessions', () => {
    it('rotates refresh tokens: the new one works, the old one does not', async () => {
      const login = await loginAs(t, 'passenger');
      const r1 = await t
        .http()
        .post('/auth/refresh')
        .send({ refreshToken: login.refreshToken })
        .expect(200);
      expect(r1.body.refreshToken).not.toBe(login.refreshToken);
      await t.http().post('/auth/refresh').send({ refreshToken: r1.body.refreshToken }).expect(200);
    });

    it('reusing an old refresh token revokes the whole session family', async () => {
      const login = await loginAs(t, 'passenger');
      const r1 = await t
        .http()
        .post('/auth/refresh')
        .send({ refreshToken: login.refreshToken })
        .expect(200);
      // Attacker replays the original (already rotated) token:
      await t.http().post('/auth/refresh').send({ refreshToken: login.refreshToken }).expect(401);
      // The legitimate newest token is now dead too, forcing a fresh login.
      await t.http().post('/auth/refresh').send({ refreshToken: r1.body.refreshToken }).expect(401);
    });

    it('logout revokes the session', async () => {
      const login = await loginAs(t, 'driver');
      await t.http().post('/auth/logout').send({ refreshToken: login.refreshToken }).expect(204);
      await t.http().post('/auth/refresh').send({ refreshToken: login.refreshToken }).expect(401);
    });

    it('stores refresh tokens only as hashes', async () => {
      const login = await loginAs(t, 'passenger');
      const rows = await t.db
        .selectFrom('auth_sessions')
        .select('refresh_token_hash')
        .where('user_id', '=', login.user.id)
        .execute();
      expect(rows.every((r) => r.refresh_token_hash !== login.refreshToken)).toBe(true);
    });

    it('rejects an expired refresh token', async () => {
      const login = await loginAs(t, 'passenger');
      await sql`UPDATE auth_sessions SET expires_at = now() - interval '1 second' WHERE user_id = ${login.user.id}`.execute(
        t.db,
      );
      await t.http().post('/auth/refresh').send({ refreshToken: login.refreshToken }).expect(401);
    });

    it('protected routes reject missing and forged tokens', async () => {
      await t.http().get('/auth/me').expect(401);
      await t.http().get('/auth/me').set('Authorization', 'Bearer abc.def.ghi').expect(401);
    });

    it('a deleted account cannot log in', async () => {
      const phone = uniquePhone();
      const login = await loginAs(t, 'passenger', phone);
      await t.db
        .updateTable('users')
        .set({ status: 'deleted' })
        .where('id', '=', login.user.id)
        .execute();
      await skipCooldown(phone);
      const req = await requestCode(phone).expect(200);
      const res = await t
        .http()
        .post('/auth/otp/verify')
        .send({
          challengeId: req.body.challengeId,
          code: t.sms.lastCodeFor(phone)!,
          role: 'passenger',
        })
        .expect(403);
      expect(res.body.error.code).toBe('ACCOUNT_DELETED');
    });
  });
});
