import { createSign } from 'node:crypto';
import { Logger } from '@nestjs/common';

export interface PushMessage {
  title: string;
  body: string;
  /** Small key/value data the app uses to open the right screen (e.g. tripId). Never secrets. */
  data: Record<string, string>;
}

/** Sends a push notification to phones. Delivery is best effort; the in-app list is the record. */
export interface PushProvider {
  /** Returns the tokens the push service says no longer exist, so they can be forgotten. */
  send(tokens: string[], message: PushMessage): Promise<{ invalidTokens: string[] }>;
}

export const PUSH_PROVIDER = Symbol('PUSH_PROVIDER');

/** DEVELOPMENT/TEST: logs instead of sending, and keeps what was "sent" for tests. Refused in production. */
export class LogPushProvider implements PushProvider {
  private readonly logger = new Logger('LogPush');
  readonly sent: { tokens: string[]; message: PushMessage }[] = [];

  async send(tokens: string[], message: PushMessage): Promise<{ invalidTokens: string[] }> {
    this.sent.push({ tokens, message });
    this.logger.debug(`[DEV PUSH — not sent] ${message.title} → ${tokens.length} device(s)`);
    return { invalidTokens: [] };
  }
}

/** The fields of a Firebase service-account key file that are used. */
export interface FirebaseServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

type FetchFn = typeof fetch;

/**
 * Firebase Cloud Messaging, HTTP v1 API, authenticated with a service account (OAuth 2.0 JWT
 * bearer grant, signed here with Node's crypto — no extra SDK). Tokens Firebase reports as
 * unregistered are returned so they are deleted.
 *
 * Tested with fake Google endpoints (`push.provider.spec.ts`); NOT verified against Firebase,
 * which needs the Firebase project (owner action OA-11).
 */
export class FcmPushProvider implements PushProvider {
  private readonly logger = new Logger('FcmPush');
  private accessToken: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly account: FirebaseServiceAccount,
    private readonly fetchImpl: FetchFn = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  /** A short-lived Google access token for the FCM scope, cached until 5 minutes before expiry. */
  private async token(): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt - 300_000 > this.now()) {
      return this.accessToken.value;
    }
    const iat = Math.floor(this.now() / 1000);
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
      iss: this.account.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat,
      exp: iat + 3600,
    })}`;
    const signature = createSign('RSA-SHA256').update(unsigned).sign(this.account.private_key);
    const res = await this.fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${unsigned}.${signature.toString('base64url')}`,
      }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => null)) as {
      access_token?: string;
      expires_in?: number;
    } | null;
    if (!res.ok || !body?.access_token) {
      throw new Error(`Google token request failed: HTTP ${res.status}`);
    }
    this.accessToken = {
      value: body.access_token,
      expiresAt: this.now() + (body.expires_in ?? 3600) * 1000,
    };
    return body.access_token;
  }

  async send(tokens: string[], message: PushMessage): Promise<{ invalidTokens: string[] }> {
    const access = await this.token();
    const url = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(this.account.project_id)}/messages:send`;
    const invalidTokens: string[] = [];
    // One request per device (FCM v1 has no multicast); a user has very few devices.
    for (const token of tokens) {
      const res = await this.fetchImpl(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: message.title, body: message.body },
            data: message.data,
            android: { priority: 'HIGH' },
            apns: { headers: { 'apns-priority': '10' } },
          },
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) continue;
      const body = (await res.json().catch(() => null)) as {
        error?: { status?: string; details?: { errorCode?: string }[] };
      } | null;
      const code = body?.error?.details?.find((d) => d.errorCode)?.errorCode ?? body?.error?.status;
      if (res.status === 404 || code === 'UNREGISTERED') {
        invalidTokens.push(token);
      } else {
        this.logger.warn({ status: res.status, code }, 'FCM rejected a message');
      }
    }
    return { invalidTokens };
  }
}

/** Reads the service account from FCM_SERVICE_ACCOUNT_BASE64 (the key file, base64-encoded). */
export function parseServiceAccount(base64: string): FirebaseServiceAccount {
  const json = JSON.parse(Buffer.from(base64, 'base64').toString('utf8')) as Partial<
    FirebaseServiceAccount & { type: string }
  >;
  if (
    json.type !== 'service_account' ||
    !json.project_id ||
    !json.client_email ||
    !json.private_key?.includes('PRIVATE KEY')
  ) {
    throw new Error('FCM_SERVICE_ACCOUNT_BASE64 is not a Firebase service-account key file');
  }
  return {
    project_id: json.project_id,
    client_email: json.client_email,
    private_key: json.private_key,
  };
}
