import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppError } from '../../common/errors';
import { safeEqualHex, sha256Hex } from '../auth/tokens';
import { AdminAuthService, type AdminPrincipal } from './admin-auth.service';
import type { Permission } from './permissions';

export const ADMIN_COOKIE = 'horide_admin';
export const CSRF_HEADER = 'x-csrf-token';

type AdminRequest = Request & { admin?: AdminPrincipal };

const PERMISSION_KEY = 'horide:admin-permission';

const ANY_ADMIN_KEY = 'horide:any-admin';

/** Every admin endpoint must declare the permission it needs. */
export const RequirePermission = (permission: Permission) =>
  SetMetadata(PERMISSION_KEY, permission);

/** For the few endpoints every signed-in admin may use (own profile, sign out). */
export const AnyAuthenticatedAdmin = () => SetMetadata(ANY_ADMIN_KEY, true);

export const CurrentAdmin = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AdminPrincipal => {
    const admin = ctx.switchToHttp().getRequest<AdminRequest>().admin;
    if (!admin) throw new Error('CurrentAdmin used on a route without AdminGuard');
    return admin;
  },
);

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0 && part.slice(0, idx).trim() === name)
      return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return undefined;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Protects admin endpoints:
 * 1. a valid, unexpired, non-idle session cookie;
 * 2. a matching CSRF token header on every state-changing request;
 * 3. the declared permission. A route with no declared permission is refused (fail closed).
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly auth: AdminAuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AdminRequest>();
    const token = readCookie(req, ADMIN_COOKIE);
    const admin = token ? await this.auth.authenticate(token) : null;
    if (!admin) {
      throw new AppError(HttpStatus.UNAUTHORIZED, 'ADMIN_UNAUTHENTICATED', 'Please sign in.');
    }

    if (!SAFE_METHODS.has(req.method)) {
      const csrf = req.headers[CSRF_HEADER];
      if (typeof csrf !== 'string' || !safeEqualHex(sha256Hex(csrf), admin.csrfHash)) {
        throw new AppError(
          HttpStatus.FORBIDDEN,
          'CSRF_FAILED',
          'Security check failed. Reload the page.',
        );
      }
    }

    const targets = [context.getHandler(), context.getClass()];
    const anyAdmin = this.reflector.getAllAndOverride<boolean | undefined>(ANY_ADMIN_KEY, targets);
    const required = this.reflector.getAllAndOverride<Permission | undefined>(
      PERMISSION_KEY,
      targets,
    );
    if (!anyAdmin && (!required || !admin.permissions.has(required))) {
      throw new AppError(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'You do not have permission for this.');
    }

    req.admin = admin;
    return true;
  }
}
