import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import { AdminGuard, ANY_ADMIN_KEY, PERMISSION_KEY } from '../src/modules/admin-auth/admin.guard';
import { PERMISSIONS } from '../src/modules/admin-auth/permissions';
import { ROLES_KEY, UserAuthGuard } from '../src/modules/auth/auth.guard';
import { startTestApp, type TestApp } from './helpers/app';

/** The only routes that may be called without logging in. Adding one here must be a deliberate decision. */
const PUBLIC_ROUTES = new Set([
  'GET /health',
  'POST /auth/otp/request',
  'POST /auth/otp/verify',
  'POST /auth/refresh',
  'POST /auth/logout',
  'POST /admin/auth/login',
  'POST /share/view', // "Share my trip": the link's secret is the authorisation (ADR-023)
]);

const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL', 'OPTIONS', 'HEAD', 'SEARCH'];

interface RouteInfo {
  route: string;
  guards: unknown[];
  roles: unknown;
  permission: unknown;
  anyAdmin: unknown;
}

/**
 * Walks every controller method registered in the application and checks its protection.
 * This catches the most common access-control bug: a new endpoint added without a guard.
 */
describe('Route security audit', () => {
  let t: TestApp;
  let routes: RouteInfo[];

  beforeAll(async () => {
    t = await startTestApp();
    routes = [];
    for (const mod of t.app.get(ModulesContainer).values()) {
      for (const wrapper of mod.controllers.values()) {
        const cls = wrapper.metatype as (new (...args: unknown[]) => unknown) | undefined;
        if (!cls) continue;
        const base = String(Reflect.getMetadata(PATH_METADATA, cls) ?? '');
        for (const name of Object.getOwnPropertyNames(cls.prototype)) {
          const handler = (cls.prototype as Record<string, unknown>)[name];
          if (name === 'constructor' || typeof handler !== 'function') continue;
          const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
          if (path === undefined) continue; // not a route
          const method = METHODS[Reflect.getMetadata(METHOD_METADATA, handler) as number];
          const full = `/${[base, path].filter((p) => p && p !== '/').join('/')}`.replace(
            /\/+/g,
            '/',
          );
          const meta = (key: string) =>
            Reflect.getMetadata(key, handler) ?? Reflect.getMetadata(key, cls);
          routes.push({
            route: `${method} ${full}`,
            guards: [
              ...(Reflect.getMetadata(GUARDS_METADATA, cls) ?? []),
              ...(Reflect.getMetadata(GUARDS_METADATA, handler) ?? []),
            ],
            roles: meta(ROLES_KEY),
            permission: meta(PERMISSION_KEY),
            anyAdmin: meta(ANY_ADMIN_KEY),
          });
        }
      }
    }
  });

  afterAll(async () => {
    await t.close();
  });

  it('finds the application routes', () => {
    expect(routes.length).toBeGreaterThan(60);
  });

  it('every admin route requires an admin session and declares a permission', () => {
    const problems = routes
      .filter((r) => r.route.split(' ')[1]!.startsWith('/admin') && !PUBLIC_ROUTES.has(r.route))
      .filter((r) => !r.guards.includes(AdminGuard) || (!r.permission && !r.anyAdmin))
      .map((r) => r.route);
    expect(problems).toEqual([]);
  });

  it('every declared admin permission exists', () => {
    const unknown = routes
      .filter((r) => r.permission && !(PERMISSIONS as readonly unknown[]).includes(r.permission))
      .map((r) => r.route);
    expect(unknown).toEqual([]);
  });

  it('every other route requires a user login and declares which roles may use it', () => {
    const problems = routes
      .filter((r) => !r.route.split(' ')[1]!.startsWith('/admin') && !PUBLIC_ROUTES.has(r.route))
      .filter(
        (r) =>
          !r.guards.includes(UserAuthGuard) ||
          !Array.isArray(r.roles) ||
          (r.roles as unknown[]).length === 0,
      )
      .map((r) => r.route);
    // /auth/me is user-authenticated without a role restriction: both roles may ask "who am I".
    expect(problems.filter((p) => p !== 'GET /auth/me')).toEqual([]);
  });

  it('public routes really are reachable without login (and nothing else is)', async () => {
    const res = await t.http().get('/trips/active');
    expect(res.status).toBe(401);
    await t.http().get('/health').expect(200);
  });
});
