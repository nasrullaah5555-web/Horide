import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PaymentMethod, VehicleCategory } from '../../database/types';

/**
 * A quote is the server's binding price offer. It is signed, so the app can carry it back when
 * booking but can't change any part of it (price, distance, places, category, who it's for).
 */
export interface QuotePayload {
  v: 1;
  pid: string; // passenger id the quote was issued to
  cat: VehicleCategory;
  pay: PaymentMethod;
  pu: [number, number]; // pickup [lat, lng]
  de: [number, number]; // destination [lat, lng]
  put?: string; // pickup text
  det?: string; // destination text
  dm: number; // route distance (m)
  ds: number; // route duration (s)
  est: boolean; // distance is an estimate
  fv: string; // fare version id
  fare: string; // total, santim, as a string (bigint-safe)
  exp: number; // expiry, unix seconds
}

export function signQuote(payload: QuotePayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}

/** Returns the payload if the signature is valid and the quote hasn't expired, otherwise null. */
export function verifyQuote(token: string, secret: string, now = Date.now()): QuotePayload | null {
  if (typeof token !== 'string' || token.length > 4000) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts as [string, string];
  const expected = Buffer.from(createHmac('sha256', secret).update(body).digest('base64url'));
  const actual = Buffer.from(sig);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as QuotePayload;
    if (p.v !== 1 || typeof p.exp !== 'number' || p.exp * 1000 <= now) return null;
    return p;
  } catch {
    return null;
  }
}
