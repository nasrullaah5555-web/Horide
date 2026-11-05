import { startTestApp, type TestApp } from './helpers/app';
import { uniquePhone } from './helpers/fixtures';

/**
 * The client IP feeds per-IP rate limits and the audit log. Behind Cloudflare + Render there are
 * two proxies; the IP must be read exactly two hops from the right of X-Forwarded-For, so a
 * client-supplied entry further left is ignored and Cloudflare's own address is skipped.
 */
describe('Client IP behind proxies (e2e)', () => {
  async function recordedIp(t: TestApp, forwardedFor: string): Promise<string | null> {
    const phone = uniquePhone();
    await t
      .http()
      .post('/auth/otp/request')
      .set('X-Forwarded-For', forwardedFor)
      .send({ phone })
      .expect(200);
    const row = await t.db
      .selectFrom('otp_challenges')
      .select('ip')
      .where('phone', '=', phone)
      .executeTakeFirstOrThrow();
    return row.ip;
  }

  it('with two proxy hops, takes the address Cloudflare saw and ignores a forged one', async () => {
    const t = await startTestApp({ TRUST_PROXY_HOPS: '2' });
    try {
      expect(await recordedIp(t, '6.6.6.6, 41.190.0.7, 172.70.1.1')).toBe('41.190.0.7');
    } finally {
      await t.close();
    }
  });

  it('with one hop (the default), takes the last address', async () => {
    const t = await startTestApp();
    try {
      expect(await recordedIp(t, '6.6.6.6, 41.190.0.7')).toBe('41.190.0.7');
    } finally {
      await t.close();
    }
  });
});
