/**
 * The city this website describes, chosen when the site is built (NEXT_PUBLIC_MUSRIDE_MARKET,
 * ADR-025): Jijiga (ET, default and production) or Nairobi (KE, staging tests). Must match the
 * API's MARKET setting.
 */
const KE = process.env.NEXT_PUBLIC_MUSRIDE_MARKET === 'KE';

export const market = KE
  ? {
      code: 'KE' as const,
      city: 'Nairobi',
      country: 'Kenya',
      currency: 'KES',
      wallet: 'M-Pesa',
      /** "cash or M-Pesa" */
      payBy: 'cash or M-Pesa',
      bajaj: 'tuk-tuk',
      law: 'Kenyan law',
      emergency: [
        { label: 'Police and emergency', number: '999' },
        { label: 'Emergency', number: '112' },
      ],
    }
  : {
      code: 'ET' as const,
      city: 'Jijiga',
      country: 'Ethiopia',
      currency: 'ETB',
      wallet: 'eBirr',
      payBy: 'cash or eBirr',
      bajaj: 'Bajaj',
      law: 'Ethiopian law',
      emergency: [
        { label: 'Police', number: '991' },
        { label: 'Ambulance', number: '907' },
        { label: 'Fire', number: '939' },
        { label: 'Traffic police', number: '945' },
      ],
    };

/** "Police 991 or Ambulance 907" / "Police and emergency 999 or Emergency 112" (first two). */
export const emergencyLine = market.emergency
  .slice(0, 2)
  .map((e) => `${e.label} ${e.number}`)
  .join(' or ');
