/**
 * The fare formula. Pure integer arithmetic in santim (1 ETB = 100 santim) — no floating point,
 * so the same inputs always give exactly the same fare on every machine.
 *
 *   raw    = base + distance_km × per_km     (distance rounded to the nearest metre)
 *   fare   = max(raw, minimum)
 *   final  = fare rounded UP to the rounding unit (e.g. nearest 5 ETB)
 */

export interface FareRates {
  baseFare: bigint;
  perKm: bigint; // santim per kilometre
  minimumFare: bigint;
  roundingUnit: bigint;
}

export interface FareBreakdown {
  base: bigint;
  distanceCharge: bigint;
  subtotal: bigint;
  minimumApplied: boolean;
  total: bigint;
}

export function calculateFare(distanceMetres: number, r: FareRates): FareBreakdown {
  if (!Number.isFinite(distanceMetres) || distanceMetres < 0) throw new Error('invalid distance');
  if (r.roundingUnit <= 0n) throw new Error('rounding unit must be positive');
  const metres = BigInt(Math.round(distanceMetres));
  // distance charge = metres × per_km / 1000, rounded half-up to the nearest santim
  const distanceCharge = (metres * r.perKm + 500n) / 1000n;
  const subtotal = r.baseFare + distanceCharge;
  const minimumApplied = subtotal < r.minimumFare;
  const beforeRounding = minimumApplied ? r.minimumFare : subtotal;
  const total = ((beforeRounding + r.roundingUnit - 1n) / r.roundingUnit) * r.roundingUnit;
  return { base: r.baseFare, distanceCharge, subtotal, minimumApplied, total };
}

/** For display only: 12345 santim -> "123.45". */
export function formatEtb(santim: bigint): string {
  const sign = santim < 0n ? '-' : '';
  const abs = santim < 0n ? -santim : santim;
  return `${sign}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}
