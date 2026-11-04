import { RateLimit } from '../../common/rate-limit';
import { Body, Controller, Get, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { Kysely } from 'kysely';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { DATABASE } from '../../database/database.module';
import type { DB } from '../../database/types';
import { type AuthUser, CurrentUser, UserAuthGuard } from './auth.guard';
import { OtpService } from './otp.service';
import { SessionService } from './session.service';

const requestOtpSchema = z.strictObject({ phone: z.string().min(9).max(25) });
const verifyOtpSchema = z.strictObject({
  challengeId: z.string().uuid(),
  code: z.string().regex(/^\d{6}$/, 'must be 6 digits'),
  role: z.enum(['passenger', 'driver']),
  deviceInfo: z.string().max(200).optional(),
});
const refreshSchema = z.strictObject({ refreshToken: z.string().min(20).max(200) });

@Controller('auth')
export class AuthController {
  constructor(
    private readonly otp: OtpService,
    private readonly sessions: SessionService,
    @Inject(DATABASE) private readonly db: Kysely<DB>,
  ) {}

  /** Step 1: send a login code by SMS. */
  @RateLimit({ name: 'otp-request', limit: 5, windowSeconds: 60 })
  @Post('otp/request')
  @HttpCode(200)
  async requestOtp(
    @Body(new ZodValidationPipe(requestOtpSchema)) body: z.infer<typeof requestOtpSchema>,
    @Req() req: Request,
  ) {
    return this.otp.request(body.phone, req.ip ?? null);
  }

  /** Step 2: exchange the code for tokens. Creates the account on first login. */
  @RateLimit({ name: 'otp-verify', limit: 10, windowSeconds: 60 })
  @Post('otp/verify')
  @HttpCode(200)
  async verifyOtp(
    @Body(new ZodValidationPipe(verifyOtpSchema)) body: z.infer<typeof verifyOtpSchema>,
  ) {
    const phone = await this.otp.verify(body.challengeId, body.code);
    return this.sessions.login(phone, body.role, body.deviceInfo ?? null);
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body(new ZodValidationPipe(refreshSchema)) body: z.infer<typeof refreshSchema>) {
    return this.sessions.refresh(body.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Body(new ZodValidationPipe(refreshSchema)) body: z.infer<typeof refreshSchema>,
  ): Promise<void> {
    await this.sessions.logout(body.refreshToken);
  }

  /** Who am I? Returns only the caller's own account. */
  @Get('me')
  @UseGuards(UserAuthGuard)
  async me(@CurrentUser() user: AuthUser) {
    return this.db
      .selectFrom('users')
      .select(['id', 'phone', 'role', 'status', 'suspended_reason', 'created_at'])
      .where('id', '=', user.id)
      .executeTakeFirstOrThrow();
  }
}
