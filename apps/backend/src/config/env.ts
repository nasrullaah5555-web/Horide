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
  STORAGE_PROVIDER: ['local'],
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
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    DATABASE_URL: z.string().url().startsWith('postgres'),
    DATABASE_SSL: boolFromString,
    CORS_ORIGINS: z
      .string()
      .default('')
      .transform((v) =>
        v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    SMS_PROVIDER: z.enum(['console', 'fake', 'afromessage']).default('console'),
    ROUTING_PROVIDER: z.enum(['dev_estimate', 'fake', 'google', 'osrm']).default('dev_estimate'),
    STORAGE_PROVIDER: z.enum(['local', 's3']).default('local'),
    STORAGE_LOCAL_DIR: z.string().min(1).default('./storage'),

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
    if (env.NODE_ENV !== 'production') return;
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
    for (const [key, banned] of Object.entries(DEV_ONLY_ADAPTERS)) {
      const value = env[key as keyof typeof DEV_ONLY_ADAPTERS];
      if ((banned as readonly string[]).includes(value)) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `"${value}" is a development-only adapter and is not allowed in production`,
        });
      }
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
