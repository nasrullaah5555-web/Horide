import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
  OnModuleDestroy,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/env';
import { verifyAccessToken } from '../modules/auth/tokens';
import { AppError } from './errors';

export interface RateLimitRule {
  name: string;
  limit: number;
  windowSeconds: number;
}

export const RATE_LIMIT_KEY = 'musride:rate-limit';
export const SKIP_RATE_LIMIT_KEY = 'musride:skip-rate-limit';

/** Applies to every request unless a route sets its own (stricter) rule as well. */
export const DEFAULT_RATE_LIMIT: RateLimitRule = { name: 'default', limit: 120, windowSeconds: 60 };

/** Adds a route-specific limit on top of the default one. */
export const RateLimit = (rule: RateLimitRule) => SetMetadata(RATE_LIMIT_KEY, rule);
/** Only for the health check, which the hosting platform calls constantly. */
export const SkipRateLimit = () => SetMetadata(SKIP_RATE_LIMIT_KEY, true);

const MAX_TRACKED_KEYS = 100_000;

/**
 * Fixed-window counters kept in memory. Correct for a single API instance (ADR-005);
 * with several instances this moves to Redis.
 */
export class FixedWindowCounter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  hit(
    key: string,
    rule: RateLimitRule,
    now = Date.now(),
  ): { allowed: boolean; retryAfterSeconds: number } {
    let w = this.windows.get(key);
    if (!w || w.resetAt <= now) {
      if (this.windows.size >= MAX_TRACKED_KEYS) this.purge(now);
      w = { count: 0, resetAt: now + rule.windowSeconds * 1000 };
      this.windows.set(key, w);
    }
    w.count++;
    return {
      allowed: w.count <= rule.limit,
      retryAfterSeconds: Math.ceil((w.resetAt - now) / 1000),
    };
  }

  purge(now = Date.now()): void {
    for (const [k, w] of this.windows) if (w.resetAt <= now) this.windows.delete(k);
  }
}

/**
 * Global guard: limits requests per logged-in user (or per IP address when not logged in).
 * Protects against API abuse and runaway apps retrying in a loop on a bad connection.
 */
@Injectable()
export class RateLimitGuard implements CanActivate, OnModuleDestroy {
  private readonly counter = new FixedWindowCounter();
  private readonly timer: NodeJS.Timeout;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly reflector: Reflector,
  ) {
    this.timer = setInterval(() => this.counter.purge(), 60_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  canActivate(context: ExecutionContext): boolean {
    if (!this.config.RATE_LIMIT_ENABLED || context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(SKIP_RATE_LIMIT_KEY, targets)) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const identity = this.identify(req);
    const rules = [DEFAULT_RATE_LIMIT];
    const specific = this.reflector.getAllAndOverride<RateLimitRule | undefined>(
      RATE_LIMIT_KEY,
      targets,
    );
    if (specific) rules.push(specific);

    for (const rule of rules) {
      const result = this.counter.hit(`${rule.name}:${identity}`, rule);
      if (!result.allowed) {
        context
          .switchToHttp()
          .getResponse<Response>()
          .setHeader('Retry-After', String(result.retryAfterSeconds));
        throw new AppError(
          HttpStatus.TOO_MANY_REQUESTS,
          'RATE_LIMITED',
          'Too many requests. Please wait a moment and try again.',
          {
            retryAfterSeconds: result.retryAfterSeconds,
          },
        );
      }
    }
    return true;
  }

  /** User id from a valid access token, else a hash of the admin session cookie, else the client IP. */
  private identify(req: Request): string {
    const auth = req.headers.authorization;
    if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
      const claims = verifyAccessToken(auth.slice(7), this.config.JWT_ACCESS_SECRET);
      if (claims) return `user:${claims.sub}`;
    }
    const cookie = req.headers.cookie?.match(/(?:^|;\s*)musride_admin=([^;]+)/)?.[1];
    if (cookie) return `admin:${createHash('sha256').update(cookie).digest('hex').slice(0, 32)}`;
    return `ip:${req.ip ?? 'unknown'}`;
  }
}
