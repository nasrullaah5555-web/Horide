import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { UserRole } from '../../database/types';

/**
 * Minimal HS256 JSON Web Tokens using Node's built-in crypto.
 * Kept small on purpose so every line can be reviewed. Only HS256 is accepted;
 * tokens claiming any other algorithm (including "none") are rejected.
 */

export interface AccessTokenClaims {
  sub: string; // user id
  role: UserRole;
  sid: string; // session family id
  typ: 'access';
  iat: number;
  exp: number;
}

const HEADER = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

function sign(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

export function signAccessToken(
  claims: Omit<AccessTokenClaims, 'iat' | 'exp' | 'typ'>,
  secret: string,
  ttlSeconds: number,
  now = Date.now(),
): { token: string; expiresAt: Date } {
  const iat = Math.floor(now / 1000);
  const payload: AccessTokenClaims = { ...claims, typ: 'access', iat, exp: iat + ttlSeconds };
  const body = `${HEADER}.${base64url(JSON.stringify(payload))}`;
  return { token: `${body}.${sign(body, secret)}`, expiresAt: new Date(payload.exp * 1000) };
}

/** Returns the claims if the token is authentic and unexpired, otherwise null. Never throws. */
export function verifyAccessToken(
  token: string,
  secret: string,
  now = Date.now(),
): AccessTokenClaims | null {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts as [string, string, string];
  if (header !== HEADER) return null; // rejects alg=none and every other algorithm
  const expected = Buffer.from(sign(`${header}.${payload}`, secret));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const claims = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as AccessTokenClaims;
    if (claims.typ !== 'access' || typeof claims.exp !== 'number') return null;
    if (claims.role !== 'passenger' && claims.role !== 'driver') return null;
    if (claims.exp * 1000 <= now) return null;
    return claims;
  } catch {
    return null;
  }
}

/** A long random refresh token (256 bits). Only its hash is stored. */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** OTP codes are stored as an HMAC tied to their challenge id, so a leaked table can't be reused. */
export function hashOtp(challengeId: string, code: string, pepper: string): string {
  return createHmac('sha256', pepper).update(`${challengeId}:${code}`).digest('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && ba.length > 0 && timingSafeEqual(ba, bb);
}
