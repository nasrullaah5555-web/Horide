import { Logger } from '@nestjs/common';

export interface PushMessage {
  title: string;
  body: string;
  /** Small key/value data the app uses to open the right screen (e.g. tripId). Never secrets. */
  data: Record<string, string>;
}

/** Sends a push notification to phones. Delivery is best effort; the in-app list is the record. */
export interface PushProvider {
  send(tokens: string[], message: PushMessage): Promise<void>;
}

export const PUSH_PROVIDER = Symbol('PUSH_PROVIDER');

/** DEVELOPMENT/TEST: logs instead of sending, and keeps what was "sent" for tests. Refused in production. */
export class LogPushProvider implements PushProvider {
  private readonly logger = new Logger('LogPush');
  readonly sent: { tokens: string[]; message: PushMessage }[] = [];

  async send(tokens: string[], message: PushMessage): Promise<void> {
    this.sent.push({ tokens, message });
    this.logger.debug(`[DEV PUSH — not sent] ${message.title} → ${tokens.length} device(s)`);
  }
}

/**
 * Firebase Cloud Messaging. Not implemented until a Firebase project and service account exist
 * to test against (owner action OA-11). Until then the API refuses to start in production with push.
 */
export class FcmPushProvider implements PushProvider {
  constructor() {
    throw new Error(
      'FCM push is not implemented yet (blocked by owner action OA-11: Firebase project and credentials).',
    );
  }
  async send(): Promise<void> {
    throw new Error('not implemented');
  }
}
