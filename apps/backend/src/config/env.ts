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
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
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
