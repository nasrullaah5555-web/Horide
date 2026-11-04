import { RateLimit } from '../../common/rate-limit';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Kysely, sql } from 'kysely';
import { z } from 'zod';
import { AppError } from '../../common/errors';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/env';
import { DATABASE } from '../../database/database.module';
import type { DB } from '../../database/types';
import { AuditService } from '../audit/audit.service';
import { AdminAccountsService, MIN_ADMIN_PASSWORD_LENGTH } from './admin-accounts.service';
import { AdminAuthService, type AdminPrincipal } from './admin-auth.service';
import {
  ADMIN_COOKIE,
  AdminGuard,
  AnyAuthenticatedAdmin,
  CurrentAdmin,
  RequirePermission,
} from './admin.guard';
import { hashPassword, verifyPassword } from './crypto';

const ROLE = z.enum(['support', 'verification', 'finance', 'operations', 'super']);

const loginSchema = z.strictObject({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
  totpCode: z.string().regex(/^\d{6}$/),
});
const passwordSchema = z.strictObject({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(MIN_ADMIN_PASSWORD_LENGTH).max(200),
});
const createAdminSchema = z.strictObject({
  email: z.string().email().max(200),
  fullName: z.string().min(1).max(120),
  roles: z.array(ROLE).min(1).max(5),
});
const rolesSchema = z.strictObject({ roles: z.array(ROLE).min(1).max(5) });
const auditQuerySchema = z.strictObject({
  entityType: z.string().max(60).optional(),
  entityId: z.string().max(100).optional(),
  actorId: z.string().uuid().optional(),
  before: z.coerce.number().int().positive().optional(), // id cursor for paging backwards
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

@Controller('admin')
export class AdminAuthController {
  constructor(
    private readonly auth: AdminAuthService,
    private readonly accounts: AdminAccountsService,
    private readonly audit: AuditService,
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @RateLimit({ name: 'admin-login', limit: 10, windowSeconds: 60 })
  @Post('auth/login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: z.infer<typeof loginSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.login(
      body.email,
      body.password,
      body.totpCode,
      req.ip ?? null,
      req.headers['user-agent'] ?? null,
    );
    res.cookie(ADMIN_COOKIE, result.sessionToken, {
      httpOnly: true, // JavaScript in the page can never read the session token
      secure: this.config.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/admin',
      expires: result.expiresAt,
    });
    // The CSRF token is given to the dashboard, which sends it back in a header on every change.
    return { csrfToken: result.csrfToken, expiresAt: result.expiresAt };
  }

  @Post('auth/logout')
  @HttpCode(204)
  @UseGuards(AdminGuard)
  @AnyAuthenticatedAdmin()
  async logout(@CurrentAdmin() admin: AdminPrincipal, @Res({ passthrough: true }) res: Response) {
    await this.auth.revoke(admin.sessionId);
    res.clearCookie(ADMIN_COOKIE, { path: '/admin' });
  }

  @Get('auth/me')
  @UseGuards(AdminGuard)
  @AnyAuthenticatedAdmin()
  me(@CurrentAdmin() admin: AdminPrincipal) {
    return {
      id: admin.id,
      email: admin.email,
      fullName: admin.fullName,
      roles: admin.roles,
      permissions: [...admin.permissions].sort(),
    };
  }

  /** Changing the password signs out every other session of this admin. */
  @Post('auth/password')
  @HttpCode(204)
  @UseGuards(AdminGuard)
  @AnyAuthenticatedAdmin()
  async changePassword(
    @CurrentAdmin() admin: AdminPrincipal,
    @Body(new ZodValidationPipe(passwordSchema)) body: z.infer<typeof passwordSchema>,
    @Req() req: Request,
  ) {
    const row = await this.db
      .selectFrom('admin_users')
      .select('password_hash')
      .where('id', '=', admin.id)
      .executeTakeFirstOrThrow();
    if (!(await verifyPassword(body.currentPassword, row.password_hash))) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'WRONG_PASSWORD',
        'Current password is incorrect.',
      );
    }
    const newHash = await hashPassword(body.newPassword);
    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('admin_users')
        .set({ password_hash: newHash })
        .where('id', '=', admin.id)
        .execute();
      await trx
        .updateTable('admin_sessions')
        .set({ revoked_at: sql`now()` })
        .where('admin_user_id', '=', admin.id)
        .where('id', '<>', admin.sessionId)
        .where('revoked_at', 'is', null)
        .execute();
      await this.audit.record(trx, {
        actorType: 'admin',
        actorId: admin.id,
        action: 'admin.password_changed',
        entityType: 'admin_user',
        entityId: admin.id,
        ip: req.ip ?? null,
      });
    });
  }

  @Get('admins')
  @UseGuards(AdminGuard)
  @RequirePermission('admins.read')
  async listAdmins() {
    const admins = await this.db
      .selectFrom('admin_users as a')
      .leftJoin('admin_roles as r', 'r.admin_user_id', 'a.id')
      .select([
        'a.id',
        'a.email',
        'a.full_name',
        'a.status',
        'a.last_login_at',
        'a.created_at',
        sql<
          string[]
        >`coalesce(array_agg(r.role::text ORDER BY r.role) FILTER (WHERE r.role IS NOT NULL), '{}')`.as(
          'roles',
        ),
      ])
      .groupBy('a.id')
      .orderBy('a.created_at')
      .execute();
    return { admins };
  }

  @Post('admins')
  @HttpCode(201)
  @UseGuards(AdminGuard)
  @RequirePermission('admins.write')
  async createAdmin(
    @CurrentAdmin() admin: AdminPrincipal,
    @Body(new ZodValidationPipe(createAdminSchema)) body: z.infer<typeof createAdminSchema>,
    @Req() req: Request,
  ) {
    return this.accounts.create(body, { id: admin.id, ip: req.ip ?? null });
  }

  @Put('admins/:id/roles')
  @HttpCode(204)
  @UseGuards(AdminGuard)
  @RequirePermission('admins.write')
  async setRoles(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(rolesSchema)) body: z.infer<typeof rolesSchema>,
    @Req() req: Request,
  ) {
    await this.accounts.setRoles(id, body.roles, { id: admin.id, ip: req.ip ?? null });
    if (id !== admin.id) await this.auth.revokeAllFor(id); // new roles apply from the next sign-in
  }

  @Post('admins/:id/disable')
  @HttpCode(204)
  @UseGuards(AdminGuard)
  @RequirePermission('admins.write')
  async disable(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    await this.accounts.setStatus(id, 'disabled', { id: admin.id, ip: req.ip ?? null });
    await this.auth.revokeAllFor(id);
  }

  @Post('admins/:id/enable')
  @HttpCode(204)
  @UseGuards(AdminGuard)
  @RequirePermission('admins.write')
  async enable(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    await this.accounts.setStatus(id, 'active', { id: admin.id, ip: req.ip ?? null });
  }

  @Get('audit-logs')
  @UseGuards(AdminGuard)
  @RequirePermission('audit.read')
  async auditLogs(
    @Query(new ZodValidationPipe(auditQuerySchema)) q: z.infer<typeof auditQuerySchema>,
  ) {
    let query = this.db.selectFrom('audit_logs').selectAll().orderBy('id', 'desc').limit(q.limit);
    if (q.entityType) query = query.where('entity_type', '=', q.entityType);
    if (q.entityId) query = query.where('entity_id', '=', q.entityId);
    if (q.actorId) query = query.where('actor_id', '=', q.actorId);
    if (q.before) query = query.where('id', '<', String(q.before));
    const entries = await query.execute();
    return {
      entries,
      nextBefore: entries.length === q.limit ? entries[entries.length - 1]?.id : null,
    };
  }
}
