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
 * Kenyan mobile numbers (07… and 01…), for test deployments only (KENYA_TEST_MODE).
 * The country code is required: "0712 345 678" is also a valid Safaricom Ethiopia number, so a
 * number without +254/254 is always read as Ethiopian.
 */
export function normalizeKenyanMobile(input: string): string | null {
  if (typeof input !== 'string' || input.length > 25) return null;
  const digits = input.replace(/[\s()-]/g, '');
  const m = /^\+?254([17]\d{8})$/.exec(digits);
  return m ? `+254${m[1]}` : null;
}

/** Ethiopian always; Kenyan too when the deployment allows Kenyan test numbers. */
export function normalizeMobile(input: string, allowKenya: boolean): string | null {
  return normalizeEthiopianMobile(input) ?? (allowKenya ? normalizeKenyanMobile(input) : null);
}

/** Shows only the last 3 digits, for logs and support screens: +2519*****567 */
export function maskPhone(e164: string): string {
  return e164.length > 8
    ? `${e164.slice(0, 5)}${'*'.repeat(e164.length - 8)}${e164.slice(-3)}`
    : '***';
}
