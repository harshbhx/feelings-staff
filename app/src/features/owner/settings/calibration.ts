/**
 * Geofence calibration on this phone (PRD 4.15.2, O-09): watch the position for 60 s at the salon
 * counter and keep every fix (at most 200), with the live best accuracy for the screen. The server
 * stores each session and proposes the circle once there are at least two.
 */

export const CALIBRATION_MS = 60_000;
export const MAX_SAMPLES = 200;

export interface CalibrationFix {
  lat: number;
  lng: number;
  accuracyM: number;
  takenAt: number;
}

export type Platform = 'android' | 'ios' | 'desktop' | 'other';

export function platformOf(ua: string): Platform {
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  if (/Windows|Macintosh|Linux|CrOS/i.test(ua)) return 'desktop';
  return 'other';
}

export interface CalibrationRun {
  promise: Promise<{ fixes: CalibrationFix[]; error: 'denied' | 'unavailable' | null }>;
  stop: () => void;
}

/** Collect fixes for `ms`; `onFix` gets the best accuracy so far. Never rejects. */
export function collectFixes(
  onFix: (bestAccuracyM: number, count: number) => void,
  ms: number = CALIBRATION_MS,
  geo: Pick<Geolocation, 'watchPosition' | 'clearWatch'> | undefined = typeof navigator !==
  'undefined'
    ? navigator.geolocation
    : undefined,
): CalibrationRun {
  const fixes: CalibrationFix[] = [];
  let finish: (error: 'denied' | 'unavailable' | null) => void = () => {};
  const promise = new Promise<{ fixes: CalibrationFix[]; error: 'denied' | 'unavailable' | null }>(
    (resolve) => {
      if (!geo) {
        resolve({ fixes, error: 'unavailable' });
        return;
      }
      let done = false;
      const id = geo.watchPosition(
        (pos) => {
          if (fixes.length >= MAX_SAMPLES) return;
          fixes.push({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracyM: pos.coords.accuracy,
            takenAt: pos.timestamp,
          });
          onFix(Math.min(...fixes.map((f) => f.accuracyM)), fixes.length);
        },
        (err) => finish(err.code === 1 ? 'denied' : fixes.length > 0 ? null : 'unavailable'),
        { enableHighAccuracy: true, maximumAge: 0, timeout: ms },
      );
      const timer = setTimeout(() => finish(null), ms);
      finish = (error) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        geo.clearWatch(id);
        resolve({ fixes, error: fixes.length === 0 && error === null ? 'unavailable' : error });
      };
    },
  );
  return { promise, stop: () => finish(null) };
}
