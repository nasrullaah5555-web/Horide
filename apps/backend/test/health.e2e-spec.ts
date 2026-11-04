import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../src/bootstrap';
import { loadConfig } from '../src/config/env';

describe('API foundation (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp(loadConfig());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health reports the database as up', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body).toEqual({ status: 'ok', database: 'up' });
  });

  it('sets security headers and hides the framework', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeDefined();
  });

  it('returns errors in the standard shape', async () => {
    const res = await request(app.getHttpServer()).get('/does-not-exist').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(typeof res.body.error.message).toBe('string');
    expect(typeof res.body.requestId).toBe('string');
  });

  it('ignores unsafe client request ids', async () => {
    const res = await request(app.getHttpServer())
      .get('/does-not-exist')
      .set('x-request-id', '<script>alert(1)</script>');
    expect(res.body.requestId).not.toContain('<');
  });

  it('only allows configured CORS origins', async () => {
    const allowed = await request(app.getHttpServer())
      .get('/health')
      .set('Origin', 'http://localhost:3001');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:3001');
    const denied = await request(app.getHttpServer())
      .get('/health')
      .set('Origin', 'https://evil.example');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejects oversized JSON bodies', async () => {
    const big = JSON.stringify({ x: 'a'.repeat(200 * 1024) });
    const res = await request(app.getHttpServer())
      .post('/health')
      .set('Content-Type', 'application/json')
      .send(big)
      .expect(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('rejects malformed JSON with 400, not 500', async () => {
    const res = await request(app.getHttpServer())
      .post('/health')
      .set('Content-Type', 'application/json')
      .send('{"broken":')
      .expect(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });
});

describe('Health when the database is down', () => {
  it('returns 503 without leaking details', async () => {
    const app = await createApp(
      loadConfig({ ...process.env, DATABASE_URL: 'postgres://nobody:x@127.0.0.1:1/none' }),
    );
    await app.init();
    try {
      const res = await request(app.getHttpServer()).get('/health').expect(503);
      expect(res.body.error.code).toBe('DATABASE_UNAVAILABLE');
      expect(JSON.stringify(res.body)).not.toMatch(/127\.0\.0\.1|ECONNREFUSED/);
    } finally {
      await app.close();
    }
  });
});
