import {
  decryptSecret,
  encryptSecret,
  generateTotpSecret,
  hashPassword,
  matchTotp,
  totpCode,
  verifyPassword,
} from './crypto';
import { permissionsFor, ROLE_PERMISSIONS } from './permissions';

describe('TOTP', () => {
  // RFC 6238 Appendix B test vector: ASCII secret "12345678901234567890", T = 59 s.
  const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

  it('matches the RFC 6238 test vector', () => {
    // RFC gives the 8-digit value 94287082; authenticator apps use the last 6 digits.
    expect(totpCode(RFC_SECRET, Math.floor(59 / 30))).toBe('287082');
  });

  it('accepts the current code and one step of drift, not more', () => {
    const secret = generateTotpSecret();
    const now = 1_800_000_000_000;
    const step = Math.floor(now / 30_000);
    expect(matchTotp(secret, totpCode(secret, step), now)).toBe(step);
    expect(matchTotp(secret, totpCode(secret, step - 1), now)).toBe(step - 1);
    expect(matchTotp(secret, totpCode(secret, step + 1), now)).toBe(step + 1);
    expect(matchTotp(secret, totpCode(secret, step - 3), now)).toBeNull();
  });

  it('rejects malformed codes', () => {
    expect(matchTotp(generateTotpSecret(), '12345')).toBeNull();
    expect(matchTotp(generateTotpSecret(), 'abcdef')).toBeNull();
  });

  it('generates 32-character base32 secrets (160 bits)', () => {
    expect(generateTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });
});

describe('password hashing', () => {
  it('verifies the right password and rejects others', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).toMatch(/^scrypt\$131072\$8\$1\$/);
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
    expect(await verifyPassword('Correct horse battery staple', hash)).toBe(false);
  });

  it('uses a unique salt each time', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });
});

describe('secret encryption', () => {
  const key = Buffer.alloc(32, 9).toString('base64');

  it('round-trips and detects tampering', () => {
    const enc = encryptSecret('JBSWY3DPEHPK3PXP', key);
    expect(enc).not.toContain('JBSWY3DPEHPK3PXP');
    expect(decryptSecret(enc, key)).toBe('JBSWY3DPEHPK3PXP');
    const parts = enc.split('.');
    parts[3] = Buffer.from('tampered').toString('base64');
    expect(() => decryptSecret(parts.join('.'), key)).toThrow();
  });

  it('fails with the wrong key', () => {
    const enc = encryptSecret('JBSWY3DPEHPK3PXP', key);
    expect(() => decryptSecret(enc, Buffer.alloc(32, 1).toString('base64'))).toThrow();
  });
});

describe('role permissions', () => {
  it('support staff have no finance, pricing or admin powers', () => {
    const p = permissionsFor(['support']);
    for (const denied of [
      'payments.resolve',
      'subscriptions.write',
      'pricing.write',
      'admins.write',
      'documents.read',
    ] as const) {
      expect(p.has(denied)).toBe(false);
    }
  });

  it('super admins do not automatically see driver documents', () => {
    expect(permissionsFor(['super']).has('documents.read')).toBe(false);
  });

  it('roles combine', () => {
    const p = permissionsFor(['support', 'finance']);
    expect(p.has('complaints.write')).toBe(true);
    expect(p.has('payments.resolve')).toBe(true);
  });

  it('every role has at least one permission', () => {
    for (const perms of Object.values(ROLE_PERMISSIONS)) expect(perms.length).toBeGreaterThan(0);
  });
});
