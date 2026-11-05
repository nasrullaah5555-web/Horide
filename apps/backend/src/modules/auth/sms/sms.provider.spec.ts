import { AfroMessageSmsProvider } from './sms.provider';

function fake(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('AfroMessageSmsProvider (fake gateway; unverified against the real one, OA-08)', () => {
  it('posts the number, text and sender with the bearer token', async () => {
    const f = fake(200, { acknowledge: 'success', response: { message_id: 'm1' } });
    await new AfroMessageSmsProvider({ token: 'tok', sender: 'Horide' }, f.fn).send(
      '+251911234567',
      'Your Horide code is 123456',
    );
    expect(f.calls[0]!.url).toBe('https://api.afromessage.com/api/send');
    expect(f.calls[0]!.init.method).toBe('POST');
    expect((f.calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(JSON.parse(f.calls[0]!.init.body as string)).toEqual({
      to: '+251911234567',
      message: 'Your Horide code is 123456',
      sender: 'Horide',
    });
  });

  it('treats acknowledge=error, HTTP errors and network failures as failures', async () => {
    const send = (fn: typeof fetch) =>
      new AfroMessageSmsProvider({ token: 't' }, fn).send('+251911234567', 'x');
    await expect(send(fake(200, { acknowledge: 'error', response: {} }).fn)).rejects.toThrow();
    await expect(send(fake(401, {}).fn)).rejects.toThrow(/401/);
    const down = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(send(down)).rejects.toThrow(/unreachable/);
  });
});
