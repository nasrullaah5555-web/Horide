import { Logger } from '@nestjs/common';

/** Anything that can deliver a text message. Production uses a real Ethiopian-capable provider. */
export interface SmsProvider {
  send(toE164: string, message: string): Promise<void>;
}

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');

/**
 * DEVELOPMENT ONLY: prints the message to the server console instead of sending it.
 * Production configuration refuses to start with this provider.
 */
export class ConsoleSmsProvider implements SmsProvider {
  private readonly logger = new Logger('ConsoleSms');

  async send(toE164: string, message: string): Promise<void> {
    this.logger.warn(`[DEV SMS — not sent] to ${toE164}: ${message}`);
  }
}

/** TESTS ONLY: keeps messages in memory so tests can read the OTP code. */
export class FakeSmsProvider implements SmsProvider {
  readonly sent: { to: string; message: string }[] = [];
  failNext = false;

  async send(to: string, message: string): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('fake SMS failure');
    }
    this.sent.push({ to, message });
  }

  lastCodeFor(to: string): string | undefined {
    const msg = [...this.sent].reverse().find((m) => m.to === to)?.message;
    return msg?.match(/\b(\d{6})\b/)?.[1];
  }
}

/**
 * Placeholder for the production SMS provider (OWNER_ACTION_REGISTER OA-08).
 * Deliberately not implemented: writing an integration without the provider's current API
 * documentation and a test account would produce untested code that only looks finished.
 * The server will not start in production until this is implemented and verified.
 */
export class AfroMessageSmsProvider implements SmsProvider {
  constructor() {
    throw new Error(
      'AfroMessage SMS provider is not implemented yet (blocked by owner action OA-08: provider account and API documentation).',
    );
  }

  async send(): Promise<void> {
    throw new Error('not implemented');
  }
}
