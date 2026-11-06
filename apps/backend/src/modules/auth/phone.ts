/**
 * Ethiopian mobile numbers: Ethio Telecom (09…) and Safaricom Ethiopia (07…).
 * Accepts the forms people actually type and returns E.164 (+2519XXXXXXXX), or null if invalid.
 *   0911234567, 911234567, 251911234567, +251911234567, "+251 91 123 4567"
 */
export function normalizeEthiopianMobile(input: string): string | null {
  if (typeof input !== 'string' || input.length > 25) return null;
  const digits = input.replace(/[\s()-]/g, '');
  let national: string;
  if (/^\+251\d{9}$/.test(digits)) national = digits.slice(4);
  else if (/^251\d{9}$/.test(digits)) national = digits.slice(3);
  else if (/^0\d{9}$/.test(digits)) national = digits.slice(1);
  else if (/^\d{9}$/.test(digits)) national = digits;
  else return null;
  return /^[79]\d{8}$/.test(national) ? `+251${national}` : null;
}

/**
 * Kenyan mobile numbers (Safaricom/Airtel/Telkom 07… and 01…).
 * Accepts 0712345678, 712345678, 254712345678, +254712345678, "+254 712 345 678".
 */
export function normalizeKenyanMobile(input: string): string | null {
  if (typeof input !== 'string' || input.length > 25) return null;
  const digits = input.replace(/[\s()-]/g, '');
  let national: string;
  if (/^\+254\d{9}$/.test(digits)) national = digits.slice(4);
  else if (/^254\d{9}$/.test(digits)) national = digits.slice(3);
  else if (/^0\d{9}$/.test(digits)) national = digits.slice(1);
  else if (/^\d{9}$/.test(digits)) national = digits;
  else return null;
  return /^[17]\d{8}$/.test(national) ? `+254${national}` : null;
}

/**
 * A mobile number for this market. Numbers written without a country code are read as local
 * (07… exists in both Ethiopia and Kenya). The other country's numbers are accepted only with
 * their country code, so a visitor can still sign in with their home number.
 */
export function normalizeMobile(input: string, market: 'ET' | 'KE'): string | null {
  const digits = typeof input === 'string' ? input.replace(/[\s()-]/g, '') : '';
  const international = /^\+?(251|254)/.test(digits);
  if (market === 'KE') {
    return (
      normalizeKenyanMobile(input) ??
      (international && /^\+?251/.test(digits) ? normalizeEthiopianMobile(input) : null)
    );
  }
  return (
    normalizeEthiopianMobile(input) ??
    (international && /^\+?254/.test(digits) ? normalizeKenyanMobile(input) : null)
  );
}

/** Shows only the last 3 digits, for logs and support screens: +2519*****567 */
export function maskPhone(e164: string): string {
  return e164.length > 8
    ? `${e164.slice(0, 5)}${'*'.repeat(e164.length - 8)}${e164.slice(-3)}`
    : '***';
}
