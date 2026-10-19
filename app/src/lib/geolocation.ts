/**
 * Location for punches (PRD 4.3.1, 4.3.3, 9.4). Owner: WP-4.
 *
 * - `geolocationPermission()` reads the permission state for the pre-permission card. iOS Safari
 *   has no Permissions API for geolocation (and can report `prompt` after a denial), so it answers
 *   `unknown` there and the real request decides.
 * - `sampleLocation()` runs `watchPosition({ enableHighAccuracy: true, maximumAge: 0,
 *   timeout: 20000 })`, keeps every fix, and stops after 10 s or as soon as a fix has
 *   `accuracy <= 30` m. When no fix arrives in 20 s (or the position is unavailable) it retries once
 *   with `enableHighAccuracy: false`. The watch is always cleared.
 * - `summariseFixes()` turns the collected fixes into the contract `Fix` sent with the punch.
 *
 * Location is read only from a tap (Check in, Check out, Allow location); the app never tracks.
 */
import type { Fix } from '@fs/contracts';
import { haversineM } from '@fs/engine';

export type GeoPermission = 'granted' | 'denied' | 'prompt' | 'unknown';

/** Permission state for the pre-permission card; `unknown` where the browser cannot tell. */
export async function geolocationPermission(
  permissions: Pick<Permissions, 'query'> | undefined = typeof navigator === 'undefined'
    ? undefined
    : navigator.permissions,
): Promise<GeoPermission> {
  if (!permissions?.query) return 'unknown';
  try {
    const status = await permissions.query({ name: 'geolocation' });
    return status.state;
  } catch {
    return 'unknown';
  }
}

/** One collected position, reduced to what the fix summary needs. */
export interface FixSample {
  lat: number;
  lng: number;
  accuracy: number;
  altitude: number | null;
  altitudeAccuracy: number | null;
  speed: number | null;
  heading: number | null;
  ts: number;
}

export function toSample(pos: GeolocationPosition): FixSample {
  const c = pos.coords;
  return {
    lat: c.latitude,
    lng: c.longitude,
    accuracy: c.accuracy,
    altitude: c.altitude ?? null,
    altitudeAccuracy: c.altitudeAccuracy ?? null,
    speed: c.speed ?? null,
    heading: c.heading ?? null,
    ts: pos.timestamp,
  };
}

const same6 = (a: number, b: number) => a.toFixed(6) === b.toFixed(6);

/**
 * The contract `Fix` for the collected samples (PRD 9.4), or null when there are none:
 * best fix = smallest accuracy; `spreadM` = largest distance between any two fixes (0 when all are
 * identical to 6 decimals); `accuracySpreadM` = max - min accuracy; `altitudeNullAll` and
 * `speedNullAll` say whether those readings were null on every sample (a zero-jitter signal).
 */
export function summariseFixes(fixes: readonly FixSample[]): Fix | null {
  const first = fixes[0];
  if (!first) return null;
  let best = first;
  let minAcc = first.accuracy;
  let maxAcc = first.accuracy;
  for (const f of fixes) {
    if (f.accuracy < best.accuracy) best = f;
    if (f.accuracy < minAcc) minAcc = f.accuracy;
    if (f.accuracy > maxAcc) maxAcc = f.accuracy;
  }
  const identical = fixes.every((f) => same6(f.lat, first.lat) && same6(f.lng, first.lng));
  let spreadM = 0;
  if (!identical) {
    for (let i = 0; i < fixes.length; i++) {
      for (let j = i + 1; j < fixes.length; j++) {
        const a = fixes[i];
        const b = fixes[j];
        if (a && b) spreadM = Math.max(spreadM, haversineM(a, b));
      }
    }
  }
  return {
    lat: best.lat,
    lng: best.lng,
    accuracy: Math.max(0, best.accuracy),
    samples: fixes.length,
    spreadM,
    accuracySpreadM: Math.max(0, maxAcc - minAcc),
    altitudeNullAll: fixes.every((f) => f.altitude === null && f.altitudeAccuracy === null),
    speedNullAll: fixes.every((f) => f.speed === null && f.heading === null),
  };
}

/** Why no fix: permission denied, position unavailable, timed out, no API, or cancelled. */
export type LocateError = 'denied' | 'unavailable' | 'timeout' | 'unsupported' | 'aborted';

/** GeolocationPositionError codes: 1 denied, 2 unavailable, 3 timeout. */
export function mapGeoError(code: number): 'denied' | 'unavailable' | 'timeout' {
  if (code === 1) return 'denied';
  if (code === 3) return 'timeout';
  return 'unavailable';
}

export interface LocateProgress {
  /** Best accuracy so far in metres ("Finding you… 42 m accuracy"); null before the first fix. */
  bestAccuracyM: number | null;
  samples: number;
  /** True once the retry without high accuracy has started. */
  lowAccuracy: boolean;
}

export type LocateResult =
  | { ok: true; fix: Fix; fixes: FixSample[] }
  | { ok: false; error: LocateError; fixes: FixSample[] };

export interface SampleOptions {
  geolocation?: Pick<Geolocation, 'watchPosition' | 'clearWatch'> | undefined;
  /** Stop collecting this long after the start (default 10 s). */
  windowMs?: number;
  /** Stop as soon as a fix is at least this accurate (default 30 m). */
  goodAccuracyM?: number;
  /** No fix within this time counts as a timeout (default 20 s). */
  timeoutMs?: number;
  onProgress?: (p: LocateProgress) => void;
  signal?: AbortSignal;
}

export const LOCATE_WINDOW_MS = 10_000;
export const LOCATE_GOOD_ACCURACY_M = 30;
export const LOCATE_TIMEOUT_MS = 20_000;

function defaultGeolocation(): SampleOptions['geolocation'] {
  if (typeof navigator === 'undefined') return undefined;
  return navigator.geolocation ?? undefined;
}

/** Collect fixes for one punch (see the header comment for the rules). Never rejects. */
export function sampleLocation(opts: SampleOptions = {}): Promise<LocateResult> {
  const geo = 'geolocation' in opts ? opts.geolocation : defaultGeolocation();
  if (!geo) return Promise.resolve({ ok: false, error: 'unsupported', fixes: [] });
  const windowMs = opts.windowMs ?? LOCATE_WINDOW_MS;
  const goodM = opts.goodAccuracyM ?? LOCATE_GOOD_ACCURACY_M;
  const timeoutMs = opts.timeoutMs ?? LOCATE_TIMEOUT_MS;
  const fixes: FixSample[] = [];

  return new Promise<LocateResult>((resolve) => {
    let watchId: number | null = null;
    let attemptNo = 0;
    let done = false;
    let windowElapsed = false;
    let lastFailure: 'timeout' | 'unavailable' = 'timeout';
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    let windowTimer: ReturnType<typeof setTimeout> | undefined;

    const clear = () => {
      if (watchId !== null) geo.clearWatch(watchId);
      watchId = null;
      clearTimeout(timeoutTimer);
    };
    const finish = (r: LocateResult) => {
      if (done) return;
      done = true;
      clear();
      clearTimeout(windowTimer);
      opts.signal?.removeEventListener('abort', onAbort);
      resolve(r);
    };
    const succeed = () => {
      const fix = summariseFixes(fixes);
      finish(
        fix ? { ok: true, fix, fixes: [...fixes] } : { ok: false, error: 'unavailable', fixes: [] },
      );
    };
    const onAbort = () => finish({ ok: false, error: 'aborted', fixes: [...fixes] });

    const giveUpOrRetry = (forAttempt: number) => {
      if (done || forAttempt !== attemptNo) return;
      if (fixes.length > 0) return succeed();
      if (attemptNo === 1) return start(false);
      finish({ ok: false, error: lastFailure, fixes: [] });
    };

    const start = (highAccuracy: boolean) => {
      clear();
      attemptNo += 1;
      const mine = attemptNo;
      timeoutTimer = setTimeout(() => {
        lastFailure = 'timeout';
        giveUpOrRetry(mine);
      }, timeoutMs);
      watchId = geo.watchPosition(
        (pos) => {
          if (done || mine !== attemptNo) return;
          const sample = toSample(pos);
          fixes.push(sample);
          opts.onProgress?.({
            bestAccuracyM: Math.min(...fixes.map((f) => f.accuracy)),
            samples: fixes.length,
            lowAccuracy: !highAccuracy,
          });
          if (sample.accuracy <= goodM || windowElapsed) succeed();
        },
        (err) => {
          if (done || mine !== attemptNo) return;
          const kind = mapGeoError(err.code);
          if (kind === 'denied') {
            finish({ ok: false, error: 'denied', fixes: [...fixes] });
            return;
          }
          lastFailure = kind;
          giveUpOrRetry(mine);
        },
        { enableHighAccuracy: highAccuracy, maximumAge: 0, timeout: timeoutMs },
      );
    };

    windowTimer = setTimeout(() => {
      windowElapsed = true;
      if (fixes.length > 0) succeed();
    }, windowMs);

    if (opts.signal?.aborted) {
      onAbort();
      return;
    }
    opts.signal?.addEventListener('abort', onAbort);
    start(true);
  });
}
