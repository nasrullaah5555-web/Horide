/** Display helpers. All times are shown in East Africa Time (UTC+3), used by Jijiga and Nairobi. */
import { market } from './market';

const TZ = 'Africa/Addis_Ababa';

/** 12345 minor units → "123.45 ETB" (or KES): the market's currency. No floating point. */
export function etb(santim: string | number | null | undefined): string {
  if (santim === null || santim === undefined || santim === '') return '—';
  const n = BigInt(santim);
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const whole = (abs / 100n).toLocaleString('en-US');
  return `${neg ? '-' : ''}${whole}.${String(abs % 100n).padStart(2, '0')} ${market.currency}`;
}

export function dateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function date(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

export function ago(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const s = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

export function km(metres: number | null | undefined): string {
  if (metres === null || metres === undefined) return '—';
  return `${(metres / 1000).toFixed(1)} km`;
}

/** "driver_arriving" → "Driver arriving" */
export function humanize(value: string | null | undefined): string {
  if (!value) return '—';
  const special: Record<string, string> = {
    ebirr: 'eBirr',
    mpesa: 'M-Pesa',
    national_id: 'National ID',
  };
  if (special[value]) return special[value];
  const s = value.replace(/[_.]/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
