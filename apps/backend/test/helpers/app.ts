import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Kysely } from 'kysely';
import request from 'supertest';
import { createApp } from '../../src/bootstrap';
import { loadConfig, type AppConfig } from '../../src/config/env';
import { DATABASE } from '../../src/database/database.module';
import type { DB, UserRole } from '../../src/database/types';
import { FakeSmsProvider, SMS_PROVIDER } from '../../src/modules/auth/sms/sms.provider';
import { resetSchema } from './db';
import { uniquePhone } from './fixtures';

export interface TestApp {
  app: INestApplication;
  db: Kysely<DB>;
  sms: FakeSmsProvider;
  http: () => ReturnType<typeof request>;
  close: () => Promise<void>;
}

/** Starts the real application against a freshly migrated test database. */
export async function startTestApp(
  overrides: Partial<Record<keyof AppConfig, string>> = {},
): Promise<TestApp> {
  const app = await createApp(loadConfig({ ...process.env, ...overrides }));
  await app.init();
  const db = app.get<Kysely<DB>>(DATABASE);
  await resetSchema(db);
  return {
    app,
    db,
    sms: app.get<FakeSmsProvider>(SMS_PROVIDER),
    http: () => request(app.getHttpServer()),
    close: () => app.close(),
  };
}

/** Logs in through the real OTP flow and returns the tokens. */
export async function loginAs(t: TestApp, role: UserRole, phone = uniquePhone(), ip = randomIp()) {
  const req = await t
    .http()
    .post('/auth/otp/request')
    .set('X-Forwarded-For', ip)
    .send({ phone })
    .expect(200);
  const code = t.sms.lastCodeFor(phone);
  if (!code) throw new Error('no OTP captured');
  const res = await t
    .http()
    .post('/auth/otp/verify')
    .send({ challengeId: req.body.challengeId, code, role })
    .expect(200);
  return res.body as {
    accessToken: string;
    refreshToken: string;
    user: { id: string; role: UserRole; phone: string; isNew: boolean };
  };
}

let ipCounter = 0;
/** Each test login gets its own client IP so per-IP limits don't interfere between tests. */
export function randomIp(): string {
  ipCounter++;
  return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
}

/** The ride PIN the passenger sees, read straight from the database (tests only). */
export async function ridePin(t: TestApp, tripId: string): Promise<string> {
  const row = await t.db
    .selectFrom('trips')
    .select('start_pin')
    .where('id', '=', tripId)
    .executeTakeFirstOrThrow();
  return row.start_pin ?? '';
}
