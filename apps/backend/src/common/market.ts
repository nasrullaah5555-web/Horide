import { HttpStatus } from '@nestjs/common';
import { AppError } from './errors';
import type { PaymentMethod } from '../database/types';

/**
 * The city/country one deployment serves. Everything that differs between Jijiga and Nairobi
 * lives here, so the rest of the code asks "what does this market use?" instead of hard-coding
 * Ethiopia. One deployment serves one market (ADR-025): production is Jijiga (ET); the staging
 * server can be switched to Nairobi (KE) for testing.
 */
export type MarketCode = 'ET' | 'KE';

export interface Market {
  code: MarketCode;
  city: string;
  country: string;
  /** ISO 4217. Amounts are stored in the currency's minor unit (santim, cents). */
  currency: 'ETB' | 'KES';
  /** How passengers may pay drivers. Musride records the method; it never takes the money. */
  paymentMethods: PaymentMethod[];
  emergency: { label: string; number: string }[];
  /** Where maps start before the phone has a position. */
  centre: { lat: number; lng: number };
  phoneExample: string;
}

export const MARKETS: Record<MarketCode, Market> = {
  ET: {
    code: 'ET',
    city: 'Jijiga',
    country: 'Ethiopia',
    currency: 'ETB',
    paymentMethods: ['cash', 'ebirr'],
    emergency: [
      { label: 'Police', number: '991' },
      { label: 'Ambulance', number: '907' },
      { label: 'Fire', number: '939' },
      { label: 'Traffic police', number: '945' },
    ],
    centre: { lat: 9.3505, lng: 42.7979 },
    phoneExample: '0911 234 567',
  },
  KE: {
    code: 'KE',
    city: 'Nairobi',
    country: 'Kenya',
    currency: 'KES',
    paymentMethods: ['cash', 'mpesa'],
    // Kenya's national police and general emergency numbers (999 and 112 both work).
    emergency: [
      { label: 'Police and emergency', number: '999' },
      { label: 'Emergency', number: '112' },
    ],
    centre: { lat: -1.2864, lng: 36.8172 },
    phoneExample: '0712 345 678',
  },
};

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  cash: 'cash',
  ebirr: 'eBirr',
  mpesa: 'M-Pesa',
};

/** Refuses a payment method this market doesn't use (e.g. eBirr in Nairobi). */
export function assertPaymentMethod(market: Market, method: PaymentMethod): void {
  if (!market.paymentMethods.includes(method)) {
    throw new AppError(
      HttpStatus.BAD_REQUEST,
      'PAYMENT_METHOD_NOT_AVAILABLE',
      `${PAYMENT_LABELS[method]} is not used in ${market.city}.`,
    );
  }
}

/** Non-cash payments need the transaction reference the passenger's phone shows. */
export function assertReference(method: PaymentMethod, reference: string | undefined): void {
  if (method !== 'cash' && !reference) {
    throw new AppError(
      HttpStatus.BAD_REQUEST,
      'REFERENCE_REQUIRED',
      method === 'mpesa'
        ? 'Enter the M-Pesa confirmation code (for example SGH3K2L9QX).'
        : 'Enter the eBirr transaction reference.',
    );
  }
  if (method === 'cash' && reference) {
    throw new AppError(
      HttpStatus.BAD_REQUEST,
      'REFERENCE_NOT_ALLOWED',
      'Cash payments have no reference.',
    );
  }
}
