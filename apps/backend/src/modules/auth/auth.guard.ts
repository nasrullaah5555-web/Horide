import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppError } from '../../common/errors';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/env';
import type { UserRole } from '../../database/types';
import { verifyAccessToken } from './tokens';

export interface AuthUser {
  id: string;
  role: UserRole;
  sessionFamilyId: string;
}

type AuthedRequest = Request & { user?: AuthUser };

export const ROLES_KEY = 'horide:roles';

/** Restricts an endpoint to passengers, drivers, or both. Use together with UserAuthGuard. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

/** Gives a controller method the logged-in user: `@CurrentUser() user: AuthUser`. */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const user = ctx.switchToHttp().getRequest<AuthedRequest>().user;
  if (!user) throw new Error('CurrentUser used on a route without UserAuthGuard');
  return user;
});

/**
 * Requires a valid access token ("Authorization: Bearer <token>").
 * Deny by default: no token, a bad token, or the wrong role all fail.
 */
@Injectable()
export class UserAuthGuard implements CanActivate {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : '';
    const claims = token ? verifyAccessToken(token, this.config.JWT_ACCESS_SECRET) : null;
    if (!claims) {
      throw new AppError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Please log in.');
    }

    const allowed = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowed && !allowed.includes(claims.role)) {
      throw new AppError(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'You do not have access to this.');
    }

    req.user = { id: claims.sub, role: claims.role, sessionFamilyId: claims.sid };
    return true;
  }
}
