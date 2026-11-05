import { haversineMetres, type LatLng } from '../../common/geo';

/** A location older than this is never shown as "live" (master prompt §9). */
export const LIVE_LOCATION_MAX_AGE_SECONDS = 30;
/** Points with worse GPS accuracy than this are ignored for live position and matching. */
export const MAX_ACCURACY_METRES = 100;
/** Faster than this between two points is physically implausible in Jijiga traffic: likely spoofing or a GPS jump. */
export const MAX_PLAUSIBLE_SPEED_KMH = 150;
/** Device clocks drift; allow a little future skew, but not more. */
export const MAX_FUTURE_SKEW_SECONDS = 30;
/** Points older than this are kept for trip history but never become the "current" position. */
export const MAX_POINT_AGE_SECONDS = 120;

export interface LocationPoint extends LatLng {
  recordedAt: Date;
  accuracyM?: number;
  /** The phone reported that this position came from a mock-location (fake GPS) app. */
  mocked?: boolean;
}

export type PointVerdict =
  'ok' | 'mocked' | 'inaccurate' | 'future' | 'too_old' | 'implausible_jump';

/**
 * Checks one GPS point against the previous accepted point.
 * Small jumps over short time (GPS jitter while parked) are allowed; only real "teleports" fail.
 */
export function judgePoint(
  point: LocationPoint,
  previous: LocationPoint | null,
  now: Date,
): PointVerdict {
  // Android reports positions from mock-location apps. A modified app could hide this, so it is
  // one signal among several (speed and accuracy checks below), not a guarantee.
  if (point.mocked) return 'mocked';
  const ageSeconds = (now.getTime() - point.recordedAt.getTime()) / 1000;
  if (ageSeconds < -MAX_FUTURE_SKEW_SECONDS) return 'future';
  if (ageSeconds > MAX_POINT_AGE_SECONDS) return 'too_old';
  if (point.accuracyM !== undefined && point.accuracyM > MAX_ACCURACY_METRES) return 'inaccurate';
  if (previous) {
    const metres = haversineMetres(previous, point);
    const seconds = Math.max(
      1,
      (point.recordedAt.getTime() - previous.recordedAt.getTime()) / 1000,
    );
    const kmh = (metres / seconds) * 3.6;
    if (metres > 200 && kmh > MAX_PLAUSIBLE_SPEED_KMH) return 'implausible_jump';
  }
  return 'ok';
}
