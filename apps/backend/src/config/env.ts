import { z } from 'zod';

/**
 * Every environment variable the API reads is declared and validated here.
 * If anything is missing or wrong, the server refuses to start — better than failing later at 2 a.m.
 */

const boolFromString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

/** Adapters that only exist for development and tests. They must never run in production. */
export const DEV_ONLY_ADAPTERS = {
  SMS_PROVIDER: ['console', 'fake'],
  ROUTING_PROVIDER: ['dev_estimate', 'fake'],
  PLACES_PROVIDER: ['dev'],
  STORAGE_PROVIDER: ['local'],
  PUSH_PROVIDER: ['log'],
} as const;

/** The example secrets shipped in .env.example. Production must never run with them. */
const PLACEHOLDER_SECRETS = new Set([
  'dev-only-access-secret-change-me-0000000000',
  'dev-only-otp-pepper-change-me-00000000000000',
  'dev-only-quote-secret-change-me-00000000000',
  'ZGV2LW9ubHktdG90cC1rZXktY2hhbmdlLW1lLTAwMDA=',
]);

export const envSchema = z
  .object({
    // staging = a private test deployment: production's safety rules, but development adapters
    // (SMS codes in the server log, estimated distances, files on the server's disk) are allowed.
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    DATABASE_URL: z.string().url().startsWith('postgres'),
    DATABASE_SSL: boolFromString,
    // The database provider's CA certificate (PEM, or base64 of the PEM), for providers whose
    // certificate isn't signed by a public CA (Supabase). Verification is never switched off.
    DATABASE_CA_CERT: z.string().min(100).optional(),
    // Staging only: creates this super admin at startup when there are no admins yet, and prints
    // its one-time sign-in details to the server log (hosts without a shell, e.g. Render free).
    STAGING_BOOTSTRAP_ADMIN_EMAIL: z.string().email().optional(),
    // The public website, used to build "Share my trip" links (https://<site>/share/#<secret>).
    // Without it, sharing is switched off.
    PUBLIC_WEB_URL: z.string().url().optional(),
    // Which city this deployment serves (common/market.ts, ADR-025): currency, payment methods,
    // phone numbers, emergency numbers, service area. KE (Nairobi) is for staging tests only.
    MARKET: z.enum(['ET', 'KE']).default('ET'),
    // Connections per API instance. Keep (instances × this) under the database plan's limit.
    DATABASE_POOL_MAX: z.coerce.number().int().min(2).max(100).default(10),
    CORS_ORIGINS: z
      .string()
      .default('')
      .transform((v) =>
        v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    // How many proxies sit in front of the API and append to X-Forwarded-For. The client IP
    // (used for rate limits and audit) is read that many hops from the right, so a client can't
    // fake it by sending its own header. Render alone: 1. Cloudflare in front of Render: 2.
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
    SMS_PROVIDER: z.enum(['console', 'fake', 'afromessage']).default('console'),
    AFROMESSAGE_TOKEN: z.string().min(10).optional(),
    AFROMESSAGE_SENDER: z.string().min(1).max(11).optional(),
    AFROMESSAGE_IDENTIFIER_ID: z.string().min(1).optional(),
    ROUTING_PROVIDER: z.enum(['dev_estimate', 'fake', 'google', 'osrm']).default('dev_estimate'),
    ROUTING_GOOGLE_API_KEY: z.string().min(20).optional(),
    ROUTING_OSRM_URL: z.string().url().optional(),
    // Place search for the apps (suggestions while typing). google needs an API key with the
    // Places API (New) and Geocoding API enabled; photon is free OpenStreetMap search.
    PLACES_PROVIDER: z.enum(['dev', 'photon', 'google']).default('dev'),
    PLACES_GOOGLE_API_KEY: z.string().min(20).optional(),
    PLACES_PHOTON_URL: z.string().url().default('https://photon.komoot.io'),
    STORAGE_PROVIDER: z.enum(['local', 's3']).default('local'),
    STORAGE_LOCAL_DIR: z.string().min(1).default('./storage'),
    // S3-compatible private bucket (STORAGE_PROVIDER=s3). Required together; checked below.
    S3_BUCKET: z.string().min(3).max(63).optional(),
    S3_REGION: z.string().min(1).default('auto'),
    S3_ENDPOINT: z.string().url().optional(),
    S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    S3_FORCE_PATH_STYLE: boolFromString,
    S3_SERVER_SIDE_ENCRYPTION: boolFromString,
    PUSH_PROVIDER: z.enum(['log', 'fcm']).default('log'),
    // The Firebase service-account key file, base64-encoded (PUSH_PROVIDER=fcm). A secret.
    FCM_SERVICE_ACCOUNT_BASE64: z.string().min(100).optional(),
    // Rate limiting is always on in production; tests switch it off except in the rate-limit tests.
    RATE_LIMIT_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),

    // Secrets. No defaults: they must be provided. Generate with `openssl rand -base64 48`.
    JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
    OTP_PEPPER: z.string().min(32, 'must be at least 32 characters'),
    QUOTE_SIGNING_SECRET: z.string().min(32, 'must be at least 32 characters'),
    // 32 random bytes, base64-encoded. Encrypts admin TOTP secrets at rest (AES-256-GCM).
    ADMIN_TOTP_ENCRYPTION_KEY: z
      .string()
      .refine((v) => Buffer.from(v, 'base64').length === 32, 'must be 32 bytes encoded as base64'),
    ADMIN_SESSION_HOURS: z.coerce.number().int().min(1).max(24).default(12),
    ADMIN_IDLE_MINUTES: z.coerce.number().int().min(5).max(240).default(30),

    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    OTP_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(300),
    OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
    OTP_PER_PHONE_PER_15_MIN: z.coerce.number().int().min(1).max(20).default(3),
    OTP_PER_IP_PER_HOUR: z.coerce.number().int().min(1).max(1000).default(10),
    // Caps total SMS cost if someone abuses the endpoint with many phones and IPs.
    OTP_GLOBAL_PER_HOUR: z.coerce.number().int().min(1).default(500),
  })
  .superRefine((env, ctx) => {
    if (env.ROUTING_PROVIDER === 'google' && !env.ROUTING_GOOGLE_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['ROUTING_GOOGLE_API_KEY'],
        message: 'required when ROUTING_PROVIDER=google',
      });
    }
    if (env.PLACES_PROVIDER === 'google' && !env.PLACES_GOOGLE_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['PLACES_GOOGLE_API_KEY'],
        message: 'required when PLACES_PROVIDER=google',
      });
    }
    if (
      env.NODE_ENV === 'production' &&
      env.PLACES_PROVIDER === 'photon' &&
      env.PLACES_PHOTON_URL.includes('photon.komoot.io')
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['PLACES_PHOTON_URL'],
        message: 'the public Photon server is for testing; use Google or your own Photon server',
      });
    }
    if (env.ROUTING_PROVIDER === 'osrm' && !env.ROUTING_OSRM_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['ROUTING_OSRM_URL'],
        message: 'required when ROUTING_PROVIDER=osrm',
      });
    }
    if (env.SMS_PROVIDER === 'afromessage' && !env.AFROMESSAGE_TOKEN) {
      ctx.addIssue({
        code: 'custom',
        path: ['AFROMESSAGE_TOKEN'],
        message: 'required when SMS_PROVIDER=afromessage',
      });
    }
    if (env.PUSH_PROVIDER === 'fcm' && !env.FCM_SERVICE_ACCOUNT_BASE64) {
      ctx.addIssue({
        code: 'custom',
        path: ['FCM_SERVICE_ACCOUNT_BASE64'],
        message: 'required when PUSH_PROVIDER=fcm',
      });
    }
    if (env.STORAGE_PROVIDER === 's3') {
      for (const key of ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: 'required when STORAGE_PROVIDER=s3',
          });
        }
      }
    }
    if (
      env.PUBLIC_WEB_URL &&
      (env.NODE_ENV === 'production' || env.NODE_ENV === 'staging') &&
      !env.PUBLIC_WEB_URL.startsWith('https://')
    ) {
      ctx.addIssue({ code: 'custom', path: ['PUBLIC_WEB_URL'], message: 'must use https' });
    }
    if (env.MARKET === 'KE' && env.NODE_ENV === 'production') {
      ctx.addIssue({
        code: 'custom',
        path: ['MARKET'],
        message: 'Nairobi is for test deployments only until Kenyan licensing is done',
      });
    }
    if (env.STAGING_BOOTSTRAP_ADMIN_EMAIL && env.NODE_ENV !== 'staging') {
      ctx.addIssue({
        code: 'custom',
        path: ['STAGING_BOOTSTRAP_ADMIN_EMAIL'],
        message: 'only allowed when NODE_ENV=staging',
      });
    }
    if (env.NODE_ENV !== 'production' && env.NODE_ENV !== 'staging') return;
    if (env.ROUTING_OSRM_URL && !env.ROUTING_OSRM_URL.startsWith('https://')) {
      ctx.addIssue({
        code: 'custom',
        path: ['ROUTING_OSRM_URL'],
        message: 'must be https in production',
      });
    }
    if (env.ROUTING_OSRM_URL?.includes('router.project-osrm.org')) {
      ctx.addIssue({
        code: 'custom',
        path: ['ROUTING_OSRM_URL'],
        message: 'the public OSRM demo server is not for production use',
      });
    }
    if (env.S3_ENDPOINT && !env.S3_ENDPOINT.startsWith('https://')) {
      ctx.addIssue({
        code: 'custom',
        path: ['S3_ENDPOINT'],
        message: 'must be https in production',
      });
    }
    for (const key of [
      'JWT_ACCESS_SECRET',
      'OTP_PEPPER',
      'QUOTE_SIGNING_SECRET',
      'ADMIN_TOTP_ENCRYPTION_KEY',
    ] as const) {
      if (PLACEHOLDER_SECRETS.has(env[key])) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: 'looks like a placeholder; use a randomly generated secret in production',
        });
      }
    }
    if (new Set([env.JWT_ACCESS_SECRET, env.OTP_PEPPER, env.QUOTE_SIGNING_SECRET]).size < 3) {
      ctx.addIssue({
        code: 'custom',
        path: ['OTP_PEPPER'],
        message: 'each secret must be different',
      });
    }
    for (const [key, banned] of Object.entries(
      env.NODE_ENV === 'staging' ? {} : DEV_ONLY_ADAPTERS,
    )) {
      const value = env[key as keyof typeof DEV_ONLY_ADAPTERS];
      if ((banned as readonly string[]).includes(value)) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `"${value}" is a development-only adapter and is not allowed in production`,
        });
      }
    }
    if (!env.RATE_LIMIT_ENABLED) {
      ctx.addIssue({
        code: 'custom',
        path: ['RATE_LIMIT_ENABLED'],
        message: 'Rate limiting cannot be disabled in production',
      });
    }
    if (!env.DATABASE_SSL) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_SSL'],
        message: 'Production database connections must use SSL',
      });
    }
    if (env.CORS_ORIGINS.some((o) => !o.startsWith('https://'))) {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: 'Production CORS origins must be https',
      });
    }
  });

export type AppConfig = z.infer<typeof envSchema>;

export class ConfigError extends Error {}

/** Parses process.env (or a given object). Throws ConfigError listing every problem. */
export function loadConfig(source: Record<string, string | undefined> = process.env): AppConfig {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new ConfigError(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
}
