/**
 * The city the Musride server serves (GET /market, ADR-025): currency, payment methods and map
 * centre. Loaded once when the console opens; Jijiga until then.
 */
export interface Market {
  code: 'ET' | 'KE';
  city: string;
  currency: string;
  paymentMethods: ('cash' | 'ebirr' | 'mpesa')[];
  emergency: { label: string; number: string }[];
  centre: { lat: number; lng: number };
}

export const JIJIGA: Market = {
  code: 'ET',
  city: 'Jijiga',
  currency: 'ETB',
  paymentMethods: ['cash', 'ebirr'],
  emergency: [
    { label: 'Police', number: '991' },
    { label: 'Ambulance', number: '907' },
  ],
  centre: { lat: 9.35, lng: 42.8 },
};

export let market: Market = JIJIGA;

let loading: Promise<Market> | null = null;

/** Fetches the market once (later calls share the same answer). */
export function loadMarket(): Promise<Market> {
  loading ??= fetch('/market', { cache: 'no-store' })
    .then((r) => (r.ok ? (r.json() as Promise<Market>) : JIJIGA))
    .catch(() => JIJIGA)
    .then((m) => {
      market = m;
      return m;
    });
  return loading;
}

export const PAYMENT_LABEL: Record<string, string> = {
  cash: 'Cash',
  ebirr: 'eBirr',
  mpesa: 'M-Pesa',
};
