import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { randomInt, randomUUID } from 'node:crypto';
import { AppError } from '../../common/errors';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/env';
import { DATABASE } from '../../database/database.module';
import type { DB } from '../../database/types';
import { maskPhone, normalizeEthiopianMobile } from './phone';
import { SMS_PROVIDER, type SmsProvider } from './sms/sms.provider';
import { hashOtp, safeEqualHex } from './tokens';

export const RESEND_COOLDOWN_SECONDS = 60;

export interface OtpRequestResult {
  challengeId: string;
  expiresAt: Date;
  resendAfterSeconds: number;
}

/**
 * One-time passwords for phone login.
 * Protections: codes hashed, short expiry, limited attempts, single use, resend cooldown,
 * per-phone / per-IP / global hourly limits, and identical responses whether or not
 * an account exists (so the endpoint can't be used to discover who is registered).
 */
@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
  ) {}

  async request(rawPhone: string, ip: string | null): Promise<OtpRequestResult> {
    const phone = normalizeEthiopianMobile(rawPhone);
    if (!phone) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'INVALID_PHONE',
        'Enter a valid Ethiopian mobile number.',
      );
    }

    const challengeId = randomUUID();
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = new Date(Date.now() + this.config.OTP_TTL_SECONDS * 1000);

    await this.db.transaction().execute(async (trx) => {
      // Serialise requests for the same phone so concurrent calls can't slip past the limits.
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'otp:' + phone}))`.execute(trx);

      const counts = await trx
        .selectFrom('otp_challenges')
        .select((eb) => [
          eb.fn
            .countAll<string>()
            .filterWhere('phone', '=', phone)
            .filterWhere('created_at', '>', sql<Date>`now() - interval '15 minutes'`)
            .as('phone15'),
          eb.fn
            .countAll<string>()
            .filterWhere('phone', '=', phone)
            .filterWhere(
              'created_at',
              '>',
              sql<Date>`now() - make_interval(secs => ${RESEND_COOLDOWN_SECONDS})`,
            )
            .as('cooldown'),
          eb.fn
            .countAll<string>()
            .filterWhere(sql<boolean>`ip IS NOT DISTINCT FROM ${ip}::inet`)
            .filterWhere('created_at', '>', sql<Date>`now() - interval '1 hour'`)
            .as('ip1h'),
          eb.fn
            .countAll<string>()
            .filterWhere('created_at', '>', sql<Date>`now() - interval '1 hour'`)
            .as('global1h'),
        ])
        .where('created_at', '>', sql<Date>`now() - interval '1 hour'`)
        .executeTakeFirstOrThrow();

      if (Number(counts.cooldown) > 0) {
        throw new AppError(
          HttpStatus.TOO_MANY_REQUESTS,
          'OTP_COOLDOWN',
          `Please wait ${RESEND_COOLDOWN_SECONDS} seconds before requesting another code.`,
        );
      }
      if (Number(counts.phone15) >= this.config.OTP_PER_PHONE_PER_15_MIN) {
        throw new AppError(
          HttpStatus.TOO_MANY_REQUESTS,
          'OTP_PHONE_LIMIT',
          'Too many codes requested for this number. Try again in 15 minutes.',
        );
      }
      if (ip && Number(counts.ip1h) >= this.config.OTP_PER_IP_PER_HOUR) {
        throw new AppError(
          HttpStatus.TOO_MANY_REQUESTS,
          'OTP_IP_LIMIT',
          'Too many codes requested. Try again later.',
        );
      }
      if (Number(counts.global1h) >= this.config.OTP_GLOBAL_PER_HOUR) {
        this.logger.error('Global OTP hourly limit reached — possible SMS abuse');
        throw new AppError(
          HttpStatus.SERVICE_UNAVAILABLE,
          'OTP_TEMPORARILY_UNAVAILABLE',
          'Login codes are temporarily unavailable. Please try again shortly.',
        );
      }

      // Any older unused code for this phone stops working: only the newest code is valid.
      await trx
        .updateTable('otp_challenges')
        .set({ expires_at: sql`now()` })
        .where('phone', '=', phone)
        .where('consumed_at', 'is', null)
        .where('expires_at', '>', sql<Date>`now()`)
        .execute();

      await trx
        .insertInto('otp_challenges')
        .values({
          id: challengeId,
          phone,
          purpose: 'login',
          code_hash: hashOtp(challengeId, code, this.config.OTP_PEPPER),
          expires_at: expiresAt,
          max_attempts: this.config.OTP_MAX_ATTEMPTS,
          consumed_at: null,
          ip,
        })
        .execute();
    });

    const minutes = Math.round(this.config.OTP_TTL_SECONDS / 60);
    try {
      await this.sms.send(
        phone,
        `Your Horide code is ${code}. It expires in ${minutes} minutes. Never share this code.`,
      );
    } catch (err) {
      // Don't leave a usable code behind if the user never received it.
      await this.db
        .updateTable('otp_challenges')
        .set({ expires_at: sql`now()` })
        .where('id', '=', challengeId)
        .execute();
      this.logger.error({ err, phone: maskPhone(phone) }, 'SMS delivery failed');
      throw new AppError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'SMS_UNAVAILABLE',
        'We could not send the code. Please try again.',
      );
    }

    return { challengeId, expiresAt, resendAfterSeconds: RESEND_COOLDOWN_SECONDS };
  }

  /**
   * Checks a code. Returns the verified phone number, or throws OTP_INVALID.
   * The failed-attempt counter is committed even when verification fails.
   */
  async verify(challengeId: string, code: string): Promise<string> {
    const invalid = () =>
      new AppError(
        HttpStatus.UNAUTHORIZED,
        'OTP_INVALID',
        'The code is incorrect or has expired. Request a new code.',
      );

    if (!/^[0-9a-f-]{36}$/i.test(challengeId) || !/^\d{6}$/.test(code)) throw invalid();

    const outcome = await this.db.transaction().execute(async (trx) => {
      const challenge = await trx
        .selectFrom('otp_challenges')
        .selectAll()
        .where('id', '=', challengeId)
        .forUpdate()
        .executeTakeFirst();

      if (
        !challenge ||
        challenge.consumed_at !== null ||
        new Date(challenge.expires_at).getTime() <= Date.now() ||
        challenge.attempts >= challenge.max_attempts
      ) {
        return { ok: false as const };
      }

      const matches = safeEqualHex(
        hashOtp(challengeId, code, this.config.OTP_PEPPER),
        challenge.code_hash,
      );

      await trx
        .updateTable('otp_challenges')
        .set({
          attempts: challenge.attempts + 1,
          ...(matches ? { consumed_at: sql`now()` } : {}),
        })
        .where('id', '=', challengeId)
        .execute();

      return matches ? { ok: true as const, phone: challenge.phone } : { ok: false as const };
    });

    if (!outcome.ok) throw invalid();
    return outcome.phone;
  }
}
