/**
 * Geofence rules (PRD 4.4.1) and the calibration proposal (PRD 4.15.2). Owner: WP-4.
 * Pure functions: no I/O, deterministic for their inputs.
 */
import type { DistanceBucket, FenceCheck, FenceResult, Fix, SiteGeo } from '@fs/contracts';

/** Mean Earth radius (IUGG), metres. */
export const EARTH_RADIUS_M = 6_371_008.8;

/** Accuracy at or above this is an approximate (coarse) location and blocks the punch. */
export const APPROXIMATE_ACCURACY_M = 1000;

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in metres (haversine). */
export function haversineM(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * PASS / UNCERTAIN / OUTSIDE / APPROXIMATE (PRD 4.4.1), with `d` the distance from the best fix to
 * the site centre and `a` its accuracy:
 *
 *   a >= 1000                 -> approximate
 *   d <= R and a <= A_max     -> pass
 *   d - a <= R                -> uncertain (the accuracy circle overlaps the fence)
 *   else                      -> outside
 */
export function fenceCheck(fix: Fix, site: SiteGeo): FenceCheck {
  const distanceM = haversineM(fix, site);
  const a = fix.accuracy;
  let result: FenceResult;
  if (a >= APPROXIMATE_ACCURACY_M) result = 'approximate';
  else if (distanceM <= site.radiusM && a <= site.maxAccuracyM) result = 'pass';
  else if (distanceM - a <= site.radiusM) result = 'uncertain';
  else result = 'outside';
  return { result, distanceM };
}

const RANK: Record<FenceResult, number> = {
  pass: 0,
  uncertain: 1,
  outside: 2,
  approximate: 3,
  none: 4,
};

/**
 * Check a fix against several sites (the salon and an active venue, PRD 4.4.1: "PASS on either is
 * enough") and return the best: PASS before UNCERTAIN before OUTSIDE, then the nearest site.
 * Returns null when there are no sites.
 */
export function bestFence<S extends SiteGeo>(
  fix: Fix,
  sites: readonly S[],
): { site: S; check: FenceCheck } | null {
  let best: { site: S; check: FenceCheck } | null = null;
  for (const site of sites) {
    const check = fenceCheck(fix, site);
    if (
      !best ||
      RANK[check.result] < RANK[best.check.result] ||
      (RANK[check.result] === RANK[best.check.result] && check.distanceM < best.check.distanceM)
    ) {
      best = { site, check };
    }
  }
  return best;
}

/** Distance bucket kept after the exact distance is purged (PRD 8.2, 8.3). */
export function distanceBucket(distanceM: number): DistanceBucket {
  if (distanceM < 50) return '0-50';
  if (distanceM < 100) return '50-100';
  if (distanceM < 200) return '100-200';
  if (distanceM < 500) return '200-500';
  return '500+';
}

// ---- Calibration (PRD 4.15.2) ---------------------------------------------------------------

export interface CalibrationSample {
  lat: number;
  lng: number;
  accuracyM: number;
}

export interface CalibrationResult {
  centre: { lat: number; lng: number };
  radiusM: number;
  stats: { sessions: number; samples: number; p95DistanceM: number; medianAccuracyM: number };
  /** At least two sessions (PRD 4.15.2 step 3). */
  enoughData: boolean;
}

export const CALIBRATION_MIN_SESSIONS = 2;
export const CALIBRATION_MIN_RADIUS_M = 75;
export const CALIBRATION_MAX_RADIUS_M = 300;
export const CALIBRATION_MARGIN_M = 25;
export const CALIBRATION_STEP_M = 25;

/** Median of a non-empty list (mean of the two middle values for an even count). */
export function median(values: readonly number[]): number {
  const s = [...values].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1
    ? (s[mid] as number)
    : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

/** Nearest-rank percentile (p in 0..1) of a non-empty list. */
export function percentile(values: readonly number[], p: number): number {
  const s = [...values].sort((x, y) => x - y);
  const rank = Math.max(1, Math.ceil(p * s.length));
  return s[rank - 1] as number;
}

/**
 * Proposed centre and radius from calibration sessions (PRD 4.15.2):
 * C = median latitude and median longitude of each session's best fix (smallest accuracy);
 * R = max(75, p95 distance of all fixes from C + 25), rounded up to 25 m, capped at 300 m.
 * Returns null when there are no samples at all.
 */
export function proposeCalibration(
  sessions: readonly (readonly CalibrationSample[])[],
): CalibrationResult | null {
  const nonEmpty = sessions.filter((s) => s.length > 0);
  if (nonEmpty.length === 0) return null;
  const bests = nonEmpty.map((s) =>
    s.reduce((best, x) => (x.accuracyM < best.accuracyM ? x : best)),
  );
  const centre = { lat: median(bests.map((b) => b.lat)), lng: median(bests.map((b) => b.lng)) };
  const all = nonEmpty.flat();
  const p95 = percentile(
    all.map((x) => haversineM(x, centre)),
    0.95,
  );
  const raw = Math.max(CALIBRATION_MIN_RADIUS_M, p95 + CALIBRATION_MARGIN_M);
  const radiusM = Math.min(
    CALIBRATION_MAX_RADIUS_M,
    Math.ceil(raw / CALIBRATION_STEP_M) * CALIBRATION_STEP_M,
  );
  return {
    centre,
    radiusM,
    stats: {
      sessions: nonEmpty.length,
      samples: all.length,
      p95DistanceM: Math.round(p95 * 10) / 10,
      medianAccuracyM: Math.round(median(all.map((x) => x.accuracyM)) * 10) / 10,
    },
    enoughData: nonEmpty.length >= CALIBRATION_MIN_SESSIONS,
  };
}
