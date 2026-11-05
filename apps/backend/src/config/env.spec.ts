import { ConfigError, loadConfig } from './env';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  JWT_ACCESS_SECRET: 'a'.repeat(40),
  OTP_PEPPER: 'b'.repeat(40),
  QUOTE_SIGNING_SECRET: 'c'.repeat(40),
  ADMIN_TOTP_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
};

const productionOk = {
  ...base,
  NODE_ENV: 'production',
  DATABASE_SSL: 'true',
  CORS_ORIGINS: 'https://admin.example.com',
  SMS_PROVIDER: 'afromessage',
  AFROMESSAGE_TOKEN: 'test-token-not-real',
  ROUTING_PROVIDER: 'google',
  ROUTING_GOOGLE_API_KEY: 'AIza-test-key-not-real-000000',
  STORAGE_PROVIDER: 's3',
  S3_BUCKET: 'musride-documents',
  S3_ACCESS_KEY_ID: 'test-access-key',
  S3_SECRET_ACCESS_KEY: 'test-secret-key',
  S3_ENDPOINT: 'https://example.supabase.co/storage/v1/s3',
  PUSH_PROVIDER: 'fcm',
  FCM_SERVICE_ACCOUNT_BASE64: Buffer.from('{"type":"service_account"}'.padEnd(120, ' ')).toString(
    'base64',
  ),
};

describe('loadConfig', () => {
  it('applies safe defaults in development', () => {
    const c = loadConfig(base);
    expect(c.NODE_ENV).toBe('development');
    expect(c.PORT).toBe(3000);
    expect(c.DATABASE_SSL).toBe(false);
    expect(c.CORS_ORIGINS).toEqual([]);
  });

  it('parses comma-separated CORS origins', () => {
    const c = loadConfig({ ...base, CORS_ORIGINS: 'http://a.test, http://b.test ,' });
    expect(c.CORS_ORIGINS).toEqual(['http://a.test', 'http://b.test']);
  });

  it('rejects a missing DATABASE_URL', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
  });

  it('rejects a non-postgres DATABASE_URL', () => {
    expect(() => loadConfig({ DATABASE_URL: 'mysql://x@y/z' })).toThrow(/DATABASE_URL/);
  });

  it('accepts a correct production configuration', () => {
    expect(() => loadConfig(productionOk)).not.toThrow();
  });

  it.each([
    ['SMS_PROVIDER', 'console'],
    ['SMS_PROVIDER', 'fake'],
    ['ROUTING_PROVIDER', 'dev_estimate'],
    ['STORAGE_PROVIDER', 'local'],
  ])('refuses development adapter %s=%s in production', (key, value) => {
    expect(() => loadConfig({ ...productionOk, [key]: value })).toThrow(new RegExp(key));
  });

  it('requires SSL to the database in production', () => {
    expect(() => loadConfig({ ...productionOk, DATABASE_SSL: 'false' })).toThrow(/DATABASE_SSL/);
  });

  it('requires https CORS origins in production', () => {
    expect(() => loadConfig({ ...productionOk, CORS_ORIGINS: 'http://admin.example.com' })).toThrow(
      /CORS_ORIGINS/,
    );
  });

  it('requires secrets of at least 32 characters', () => {
    expect(() => loadConfig({ ...base, JWT_ACCESS_SECRET: 'short' })).toThrow(/JWT_ACCESS_SECRET/);
    expect(() => loadConfig({ ...base, OTP_PEPPER: undefined })).toThrow(/OTP_PEPPER/);
  });

  it('refuses placeholder secrets in production', () => {
    expect(() =>
      loadConfig({
        ...productionOk,
        JWT_ACCESS_SECRET: 'dev-only-access-secret-change-me-0000000000',
      }),
    ).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('refuses reusing one secret for several purposes in production', () => {
    expect(() => loadConfig({ ...productionOk, OTP_PEPPER: 'a'.repeat(40) })).toThrow(/different/);
  });

  it('lists every problem at once', () => {
    try {
      loadConfig({ ...productionOk, SMS_PROVIDER: 'console', STORAGE_PROVIDER: 'local' });
      fail('expected an error');
    } catch (e) {
      expect(String(e)).toMatch(/SMS_PROVIDER/);
      expect(String(e)).toMatch(/STORAGE_PROVIDER/);
    }
  });

  describe('staging (private test deployment)', () => {
    const staging = {
      ...base,
      NODE_ENV: 'staging',
      DATABASE_SSL: 'true',
      CORS_ORIGINS: 'https://musride-admin.onrender.com',
      SMS_PROVIDER: 'console',
      ROUTING_PROVIDER: 'dev_estimate',
      STORAGE_PROVIDER: 'local',
      STAGING_BOOTSTRAP_ADMIN_EMAIL: 'owner@example.com',
    };

    it('allows development adapters', () => {
      expect(() => loadConfig(staging)).not.toThrow();
    });

    it('keeps the production safety rules', () => {
      expect(() => loadConfig({ ...staging, DATABASE_SSL: 'false' })).toThrow(/DATABASE_SSL/);
      expect(() => loadConfig({ ...staging, RATE_LIMIT_ENABLED: 'false' })).toThrow(
        /RATE_LIMIT_ENABLED/,
      );
      expect(() => loadConfig({ ...staging, CORS_ORIGINS: 'http://x.test' })).toThrow(
        /CORS_ORIGINS/,
      );
      expect(() => loadConfig({ ...staging, OTP_PEPPER: staging.JWT_ACCESS_SECRET })).toThrow(
        /different/,
      );
    });

    it('never allows the bootstrap admin outside staging', () => {
      expect(() =>
        loadConfig({ ...productionOk, STAGING_BOOTSTRAP_ADMIN_EMAIL: 'owner@example.com' }),
      ).toThrow(/STAGING_BOOTSTRAP_ADMIN_EMAIL/);
    });
  });
});
