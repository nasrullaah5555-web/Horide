import { createVerify, generateKeyPairSync } from 'node:crypto';
import { FcmPushProvider, parseServiceAccount } from './push.provider';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const account = {
  project_id: 'horide-test',
  client_email: 'push@horide-test.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
};
const message = {
  title: 'Driver arriving',
  body: 'Your driver is 2 minutes away',
  data: { tripId: 't1' },
};

/** Fake Google: the token endpoint and the FCM send endpoint. */
function fakeGoogle(sendStatus: (token: string) => { status: number; body?: unknown }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url === 'https://oauth2.googleapis.com/token') {
      return new Response(JSON.stringify({ access_token: 'ya29.fake', expires_in: 3600 }), {
        status: 200,
      });
    }
    const token = JSON.parse(init.body as string).message.token as string;
    const r = sendStatus(token);
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('FcmPushProvider (fake Google endpoints)', () => {
  it('signs a valid RS256 service-account assertion for the FCM scope', async () => {
    const g = fakeGoogle(() => ({ status: 200 }));
    await new FcmPushProvider(account, g.fn).send(['tok-1'], message);
    const form = new URLSearchParams(g.calls[0]!.init.body as string);
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    const [h, p, sig] = form.get('assertion')!.split('.');
    const ok = createVerify('RSA-SHA256')
      .update(`${h}.${p}`)
      .verify(publicKey, Buffer.from(sig!, 'base64url'));
    expect(ok).toBe(true);
    const claims = JSON.parse(Buffer.from(p!, 'base64url').toString());
    expect(claims).toMatchObject({
      iss: account.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
    });
    expect(claims.exp - claims.iat).toBe(3600);
  });

  it('sends one v1 message per device with the access token, and reuses the token', async () => {
    const g = fakeGoogle(() => ({ status: 200 }));
    const fcm = new FcmPushProvider(account, g.fn);
    await fcm.send(['tok-1', 'tok-2'], message);
    await fcm.send(['tok-3'], message);
    const tokenCalls = g.calls.filter((c) => c.url.includes('oauth2'));
    const sends = g.calls.filter((c) => c.url.includes('fcm.googleapis.com'));
    expect(tokenCalls).toHaveLength(1);
    expect(sends).toHaveLength(3);
    expect(sends[0]!.url).toBe('https://fcm.googleapis.com/v1/projects/horide-test/messages:send');
    expect((sends[0]!.init.headers as Record<string, string>).Authorization).toBe(
      'Bearer ya29.fake',
    );
    const body = JSON.parse(sends[0]!.init.body as string);
    expect(body.message).toMatchObject({
      token: 'tok-1',
      notification: { title: message.title, body: message.body },
      data: { tripId: 't1' },
    });
  });

  it('gets a new access token shortly before the old one expires', async () => {
    let now = 1_000_000;
    const g = fakeGoogle(() => ({ status: 200 }));
    const fcm = new FcmPushProvider(account, g.fn, () => now);
    await fcm.send(['a'], message);
    now += 56 * 60_000; // 56 minutes later: inside the 5-minute safety margin
    await fcm.send(['b'], message);
    expect(g.calls.filter((c) => c.url.includes('oauth2'))).toHaveLength(2);
  });

  it('reports unregistered tokens so they can be deleted, and keeps going', async () => {
    const g = fakeGoogle((t) =>
      t === 'gone'
        ? {
            status: 404,
            body: { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } },
          }
        : t === 'flaky'
          ? { status: 503, body: { error: { status: 'UNAVAILABLE' } } }
          : { status: 200 },
    );
    const r = await new FcmPushProvider(account, g.fn).send(['ok', 'gone', 'flaky'], message);
    expect(r.invalidTokens).toEqual(['gone']);
  });
});

describe('parseServiceAccount', () => {
  it('reads a base64 key file and rejects anything else', () => {
    const file = { type: 'service_account', ...account, private_key_id: 'x' };
    expect(parseServiceAccount(Buffer.from(JSON.stringify(file)).toString('base64'))).toEqual(
      account,
    );
    expect(() =>
      parseServiceAccount(
        Buffer.from(JSON.stringify({ type: 'authorized_user' })).toString('base64'),
      ),
    ).toThrow(/service-account/);
  });
});
