import { maskPhone, normalizeEthiopianMobile, normalizeMobile } from './phone';
import { hashOtp, safeEqualHex, signAccessToken, verifyAccessToken } from './tokens';

const SECRET = 'unit-test-secret-0123456789abcdef0123456789';

describe('normalizeMobile (KENYA_TEST_MODE)', () => {
  it.each([
    ['+254712345678', '+254712345678'],
    ['254 712 345 678', '+254712345678'],
    ['+254110123456', '+254110123456'],
  ])('Kenyan %s is accepted only when allowed', (input, expected) => {
    expect(normalizeMobile(input, true)).toBe(expected);
    expect(normalizeMobile(input, false)).toBeNull();
  });

  it('a number without a country code stays Ethiopian even in Kenya test mode', () => {
    // 07… is valid in both countries; without +254 it is Safaricom Ethiopia.
    expect(normalizeMobile('0712345678', true)).toBe('+251712345678');
  });

  it.each(['+254812345678', '+25471234567', '+2547123456789'])('rejects %s', (input) => {
    expect(normalizeMobile(input, true)).toBeNull();
  });
});

describe('normalizeEthiopianMobile', () => {
  it.each([
    ['0911234567', '+251911234567'],
    ['911234567', '+251911234567'],
    ['251911234567', '+251911234567'],
    ['+251911234567', '+251911234567'],
    ['+251 91 123 4567', '+251911234567'],
    ['0711234567', '+251711234567'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeEthiopianMobile(input)).toBe(expected);
  });

  it.each([
    '',
    '0811234567',
    '+254711234567',
    '09112345',
    '091123456789',
    'abc',
    '+251911234567; --',
  ])('rejects %p', (input) => {
    expect(normalizeEthiopianMobile(input)).toBeNull();
  });

  it('masks all but the last three digits', () => {
    expect(maskPhone('+251911234567')).toBe('+2519*****567');
  });
});

describe('access tokens', () => {
  const claims = { sub: 'u1', role: 'passenger' as const, sid: 's1' };

  it('round-trips a valid token', () => {
    const { token } = signAccessToken(claims, SECRET, 900);
    expect(verifyAccessToken(token, SECRET)).toMatchObject({ ...claims, typ: 'access' });
  });

  it('rejects an expired token', () => {
    const { token } = signAccessToken(claims, SECRET, 60, Date.now() - 120_000);
    expect(verifyAccessToken(token, SECRET)).toBeNull();
  });

  it('rejects a token signed with another secret', () => {
    const { token } = signAccessToken(claims, 'another-secret-0123456789abcdef0123456', 900);
    expect(verifyAccessToken(token, SECRET)).toBeNull();
  });

  it('rejects a tampered payload (e.g. role changed to driver)', () => {
    const { token } = signAccessToken(claims, SECRET, 900);
    const [h, p, s] = token.split('.') as [string, string, string];
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    payload.role = 'driver';
    const forged = `${h}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${s}`;
    expect(verifyAccessToken(forged, SECRET)).toBeNull();
  });

  it('rejects alg=none tokens', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ ...claims, typ: 'access', iat: 0, exp: 9_999_999_999 }),
    ).toString('base64url');
    expect(verifyAccessToken(`${header}.${payload}.`, SECRET)).toBeNull();
  });

  it('rejects garbage without throwing', () => {
    for (const t of ['', 'a.b', 'a.b.c', '...', 'x'.repeat(5000)]) {
      expect(verifyAccessToken(t, SECRET)).toBeNull();
    }
  });
});

describe('OTP hashing', () => {
  it('binds the code to its challenge', () => {
    const a = hashOtp('challenge-1', '123456', SECRET);
    expect(safeEqualHex(a, hashOtp('challenge-1', '123456', SECRET))).toBe(true);
    expect(safeEqualHex(a, hashOtp('challenge-2', '123456', SECRET))).toBe(false);
    expect(safeEqualHex(a, hashOtp('challenge-1', '123457', SECRET))).toBe(false);
  });
});
