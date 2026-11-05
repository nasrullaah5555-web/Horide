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

export interface AfroMessageOptions {
  /** API token from the AfroMessage dashboard. A secret. */
  token: string;
  /** Approved sender name shown on the phone (e.g. "Horide"), if the account has one. */
  sender?: string;
  /** Identifier ("from") for accounts with more than one; optional. */
  identifierId?: string;
}

/**
 * AfroMessage (Ethiopian SMS gateway): POST https://api.afromessage.com/api/send with a bearer
 * token; a success answer has `acknowledge: "success"`.
 *
 * UNVERIFIED: written from AfroMessage's public SDKs (the official developer page could not be
 * opened from the development environment), and tested only against a fake server. Before
 * launch, check it against AfroMessage's current documentation and send a real code to a test
 * phone (owner action OA-08). Codes are never logged.
 */
export class AfroMessageSmsProvider implements SmsProvider {
  private readonly logger = new Logger('AfroMessageSms');

  constructor(
    private readonly opts: AfroMessageOptions,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly url = 'https://api.afromessage.com/api/send',
  ) {}

  async send(toE164: string, message: string): Promise<void> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.opts.token}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: toE164,
          message,
          ...(this.opts.sender ? { sender: this.opts.sender } : {}),
          ...(this.opts.identifierId ? { from: this.opts.identifierId } : {}),
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      throw new Error(`SMS gateway unreachable: ${String(err)}`, { cause: err });
    }
    const body = (await res.json().catch(() => null)) as {
      acknowledge?: string;
      response?: { message?: string; errors?: unknown };
    } | null;
    if (res.ok && body?.acknowledge === 'success') return;
    // The gateway's reply can contain the message text; log only status and acknowledge.
    this.logger.error({ status: res.status, acknowledge: body?.acknowledge }, 'SMS not accepted');
    throw new Error(`SMS not accepted (HTTP ${res.status})`);
  }
}
