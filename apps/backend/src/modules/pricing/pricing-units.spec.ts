import { calculateFare, formatEtb, type FareRates } from './fare-engine';
import { signQuote, verifyQuote, type QuotePayload } from './quote-token';

// Illustrative master-prompt prices: Car 40 ETB + 15 ETB/km, minimum 60, round up to 5 ETB.
const CAR: FareRates = { baseFare: 4000n, perKm: 1500n, minimumFare: 6000n, roundingUnit: 500n };
// Bajaj 20 ETB + 8 ETB/km, minimum 30, round up to 5 ETB.
const BAJAJ: FareRates = { baseFare: 2000n, perKm: 800n, minimumFare: 3000n, roundingUnit: 500n };

describe('calculateFare (worked examples)', () => {
  it.each([
    // [distance m, rates, expected total santim, explanation]
    [5000, CAR, 11500n, '40 + 5×15 = 115.00 → already a multiple of 5'],
    [3200, CAR, 9000n, '40 + 3.2×15 = 88.00 → rounded up to 90'],
    [1000, CAR, 6000n, '40 + 15 = 55 < minimum 60 → 60'],
    [0, CAR, 6000n, 'zero distance still pays the minimum'],
    [5000, BAJAJ, 6000n, '20 + 5×8 = 60.00'],
    [2345, BAJAJ, 4000n, '20 + 2.345×8 = 38.76 → 40'],
    [1000, BAJAJ, 3000n, '20 + 8 = 28 < minimum 30 → 30'],
  ])('%i m → %s', (metres, rates, expected) => {
    expect(calculateFare(metres, rates).total).toBe(expected);
  });

  it('rounds the distance charge to the nearest santim', () => {
    // 1 m × 15 ETB/km = 1.5 santim → 2 santim
    expect(calculateFare(1, { ...CAR, minimumFare: 0n, roundingUnit: 1n }).distanceCharge).toBe(2n);
  });

  it('is exact for long distances (no floating-point drift)', () => {
    const r = calculateFare(123_457, { ...CAR, roundingUnit: 1n });
    // 123.457 km × 1500 = 185185.5 → 185186 santim + 4000 base
    expect(r.total).toBe(189186n);
  });

  it('rejects negative or invalid distances', () => {
    expect(() => calculateFare(-1, CAR)).toThrow();
    expect(() => calculateFare(Number.NaN, CAR)).toThrow();
  });

  it('formats santim as ETB for display', () => {
    expect(formatEtb(11500n)).toBe('115.00');
    expect(formatEtb(3876n)).toBe('38.76');
    expect(formatEtb(5n)).toBe('0.05');
  });
});

describe('quote tokens', () => {
  const SECRET = 'quote-unit-secret-0123456789abcdef01234567';
  const payload: QuotePayload = {
    v: 1,
    pid: 'p1',
    cat: 'car',
    pay: 'cash',
    pu: [9.35, 42.8],
    de: [9.36, 42.81],
    dm: 2000,
    ds: 300,
    est: true,
    fv: 'fv1',
    fare: '9000',
    exp: Math.floor(Date.now() / 1000) + 300,
  };

  it('round-trips', () => {
    expect(verifyQuote(signQuote(payload, SECRET), SECRET)).toEqual(payload);
  });

  it('rejects any change to the price', () => {
    const token = signQuote(payload, SECRET);
    const [body, sig] = token.split('.') as [string, string];
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    p.fare = '100';
    const forged = `${Buffer.from(JSON.stringify(p)).toString('base64url')}.${sig}`;
    expect(verifyQuote(forged, SECRET)).toBeNull();
  });

  it('rejects expired quotes and wrong secrets', () => {
    expect(verifyQuote(signQuote({ ...payload, exp: 1 }, SECRET), SECRET)).toBeNull();
    expect(
      verifyQuote(signQuote(payload, 'another-secret-0123456789abcdef0123456'), SECRET),
    ).toBeNull();
  });
});
