import { haversineM } from '@fs/engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type FixSample,
  geolocationPermission,
  type LocateProgress,
  mapGeoError,
  sampleLocation,
  summariseFixes,
} from './geolocation';

const SALON = { lat: 22.4606479, lng: 70.0565093 };

function sample(over: Partial<FixSample> = {}): FixSample {
  return {
    lat: SALON.lat,
    lng: SALON.lng,
    accuracy: 20,
    altitude: 12,
    altitudeAccuracy: 4,
    speed: 0,
    heading: Number.NaN,
    ts: 1,
    ...over,
  };
}

function position(lat: number, lng: number, accuracy: number): GeolocationPosition {
  const coords = {
    latitude: lat,
    longitude: lng,
    accuracy,
    altitude: null,
    altitudeAccuracy: null,
    speed: null,
    heading: null,
    toJSON: () => ({}),
  } as GeolocationCoordinates;
  return { coords, timestamp: Date.now(), toJSON: () => ({}) } as GeolocationPosition;
}

/** A Geolocation fake that records watches and lets the test emit fixes and errors. */
function fakeGeo() {
  const watches: {
    id: number;
    ok: PositionCallback;
    err: PositionErrorCallback | null | undefined;
    options: PositionOptions | undefined;
    cleared: boolean;
  }[] = [];
  let next = 1;
  const geo = {
    watchPosition(
      ok: PositionCallback,
      err?: PositionErrorCallback | null,
      options?: PositionOptions,
    ) {
      const id = next++;
      watches.push({ id, ok, err, options, cleared: false });
      return id;
    },
    clearWatch(id: number) {
      const w = watches.find((x) => x.id === id);
      if (w) w.cleared = true;
    },
  };
  const active = () => watches.filter((w) => !w.cleared).at(-1);
  return {
    geo,
    watches,
    emit(lat: number, lng: number, accuracy: number) {
      active()?.ok(position(lat, lng, accuracy));
    },
    fail(code: 1 | 2 | 3) {
      active()?.err?.({ code, message: 'x' } as unknown as GeolocationPositionError);
    },
  };
}

describe('summariseFixes (PRD 9.4 fix summary)', () => {
  it('returns null without fixes', () => {
    expect(summariseFixes([])).toBeNull();
  });

  it('uses the most accurate fix and counts every sample', () => {
    const fixes = [
      sample({ lat: 22.46065, accuracy: 42 }),
      sample({ lat: 22.46066, accuracy: 18 }),
      sample({ lat: 22.46064, accuracy: 25 }),
    ];
    const fix = summariseFixes(fixes);
    expect(fix?.lat).toBe(22.46066);
    expect(fix?.accuracy).toBe(18);
    expect(fix?.samples).toBe(3);
    expect(fix?.accuracySpreadM).toBe(24);
  });

  it('spreadM is the largest distance between any two fixes', () => {
    const a = sample({ lat: 22.46, lng: 70.05 });
    const b = sample({ lat: 22.4601, lng: 70.05 });
    const c = sample({ lat: 22.4605, lng: 70.0502 });
    const fix = summariseFixes([a, b, c]);
    const expected = Math.max(haversineM(a, b), haversineM(a, c), haversineM(b, c));
    expect(fix?.spreadM).toBeCloseTo(expected, 6);
    expect(fix?.spreadM).toBeGreaterThan(50);
  });

  it('spreadM is 0 when every fix is identical to 6 decimals', () => {
    const fix = summariseFixes([
      sample({ lat: 22.4606471, lng: 70.0565091 }),
      sample({ lat: 22.4606474, lng: 70.0565094 }),
      sample({ lat: 22.4606472, lng: 70.0565092 }),
    ]);
    expect(fix?.spreadM).toBe(0);
  });

  it('flags readings that were null on every sample (zero-jitter inputs)', () => {
    const allNull = summariseFixes([
      sample({ altitude: null, altitudeAccuracy: null, speed: null, heading: null }),
      sample({ altitude: null, altitudeAccuracy: null, speed: null, heading: null }),
    ]);
    expect(allNull?.altitudeNullAll).toBe(true);
    expect(allNull?.speedNullAll).toBe(true);
    const some = summariseFixes([
      sample({ altitude: null, altitudeAccuracy: null, speed: null, heading: null }),
      sample({ altitude: 10, altitudeAccuracy: null, speed: 0, heading: null }),
    ]);
    expect(some?.altitudeNullAll).toBe(false);
    expect(some?.speedNullAll).toBe(false);
  });
});

describe('mapGeoError', () => {
  it('maps 1 denied, 2 unavailable, 3 timeout', () => {
    expect(mapGeoError(1)).toBe('denied');
    expect(mapGeoError(2)).toBe('unavailable');
    expect(mapGeoError(3)).toBe('timeout');
  });
});

describe('geolocationPermission', () => {
  it('reads the permission state', async () => {
    const permissions = {
      query: async () => ({ state: 'granted' }) as unknown as PermissionStatus,
    };
    expect(await geolocationPermission(permissions)).toBe('granted');
  });

  it('answers unknown without the Permissions API (iOS) or when it throws', async () => {
    expect(await geolocationPermission({} as Pick<Permissions, 'query'>)).toBe('unknown');
    const throwing = {
      query: async (): Promise<PermissionStatus> => {
        throw new TypeError('not supported');
      },
    };
    expect(await geolocationPermission(throwing)).toBe('unknown');
  });
});

describe('sampleLocation (PRD 4.3.1, 4.3.3)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('asks for high accuracy with maximumAge 0 and a 20 s timeout', () => {
    const f = fakeGeo();
    void sampleLocation({ geolocation: f.geo });
    expect(f.watches[0]?.options).toEqual({
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 20_000,
    });
  });

  it('stops as soon as a fix has accuracy <= 30 m and clears the watch', async () => {
    const f = fakeGeo();
    const progress: LocateProgress[] = [];
    const p = sampleLocation({ geolocation: f.geo, onProgress: (x) => progress.push(x) });
    f.emit(SALON.lat, SALON.lng, 64);
    f.emit(SALON.lat, SALON.lng, 28);
    const r = await p;
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.fix.accuracy).toBe(28);
      expect(r.fix.samples).toBe(2);
    }
    expect(progress.map((x) => x.bestAccuracyM)).toEqual([64, 28]);
    expect(f.watches.every((w) => w.cleared)).toBe(true);
  });

  it('keeps every fix and stops after 10 s with the best one', async () => {
    const f = fakeGeo();
    const p = sampleLocation({ geolocation: f.geo });
    f.emit(SALON.lat, SALON.lng, 90);
    await vi.advanceTimersByTimeAsync(3_000);
    f.emit(SALON.lat, SALON.lng, 55);
    await vi.advanceTimersByTimeAsync(7_000);
    const r = await p;
    expect(r.ok && r.fix.accuracy).toBe(55);
    expect(r.fixes).toHaveLength(2);
    expect(f.watches[0]?.cleared).toBe(true);
  });

  it('after 10 s without a fix, the first fix ends the sampling', async () => {
    const f = fakeGeo();
    const p = sampleLocation({ geolocation: f.geo });
    await vi.advanceTimersByTimeAsync(12_000);
    f.emit(SALON.lat, SALON.lng, 120);
    const r = await p;
    expect(r.ok && r.fix.accuracy).toBe(120);
  });

  it('retries once without high accuracy when no fix arrives in 20 s', async () => {
    const f = fakeGeo();
    const progress: LocateProgress[] = [];
    const p = sampleLocation({ geolocation: f.geo, onProgress: (x) => progress.push(x) });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(f.watches).toHaveLength(2);
    expect(f.watches[0]?.cleared).toBe(true);
    expect(f.watches[1]?.options?.enableHighAccuracy).toBe(false);
    f.emit(SALON.lat, SALON.lng, 300);
    const r = await p;
    expect(r.ok && r.fix.accuracy).toBe(300);
    expect(progress[0]?.lowAccuracy).toBe(true);
  });

  it('reports a timeout after the retry also finds nothing', async () => {
    const f = fakeGeo();
    const p = sampleLocation({ geolocation: f.geo });
    await vi.advanceTimersByTimeAsync(40_000);
    const r = await p;
    expect(r).toEqual({ ok: false, error: 'timeout', fixes: [] });
    expect(f.watches.every((w) => w.cleared)).toBe(true);
  });

  it('a watch timeout error (code 3) triggers the same single retry', async () => {
    const f = fakeGeo();
    const p = sampleLocation({ geolocation: f.geo });
    f.fail(3);
    expect(f.watches).toHaveLength(2);
    f.fail(3);
    const r = await p;
    expect(r.ok ? 'ok' : r.error).toBe('timeout');
    expect(f.watches).toHaveLength(2);
  });

  it('stops at once when permission is denied (code 1)', async () => {
    const f = fakeGeo();
    const p = sampleLocation({ geolocation: f.geo });
    f.fail(1);
    const r = await p;
    expect(r.ok ? 'ok' : r.error).toBe('denied');
    expect(f.watches).toHaveLength(1);
    expect(f.watches[0]?.cleared).toBe(true);
  });

  it('position unavailable twice ends as unavailable', async () => {
    const f = fakeGeo();
    const p = sampleLocation({ geolocation: f.geo });
    f.fail(2);
    f.fail(2);
    const r = await p;
    expect(r.ok ? 'ok' : r.error).toBe('unavailable');
  });

  it('answers unsupported without a Geolocation API', async () => {
    const r = await sampleLocation({ geolocation: undefined });
    expect(r.ok ? 'ok' : r.error).toBe('unsupported');
  });

  it('cancels and clears the watch when aborted', async () => {
    const f = fakeGeo();
    const ac = new AbortController();
    const p = sampleLocation({ geolocation: f.geo, signal: ac.signal });
    ac.abort();
    const r = await p;
    expect(r.ok ? 'ok' : r.error).toBe('aborted');
    expect(f.watches[0]?.cleared).toBe(true);
  });
});
