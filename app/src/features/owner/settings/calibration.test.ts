import { describe, expect, it, vi } from 'vitest';
import { collectFixes, MAX_SAMPLES, platformOf } from './calibration';

function fakeGeo() {
  let cb: PositionCallback | null = null;
  let err: PositionErrorCallback | null | undefined = null;
  return {
    watchPosition: vi.fn((ok: PositionCallback, bad?: PositionErrorCallback | null) => {
      cb = ok;
      err = bad;
      return 7;
    }),
    clearWatch: vi.fn(),
    emit(lat: number, accuracy: number) {
      cb?.({
        coords: { latitude: lat, longitude: 70.05, accuracy },
        timestamp: 1,
      } as GeolocationPosition);
    },
    fail(code: number) {
      err?.({ code } as GeolocationPositionError);
    },
  };
}

describe('Geofence calibration (O-09)', () => {
  it('O-09.1 a session keeps every fix for 60 s and reports the best accuracy', async () => {
    vi.useFakeTimers();
    const geo = fakeGeo();
    const seen: number[] = [];
    const run = collectFixes((best) => seen.push(best), 60_000, geo);
    geo.emit(22.46, 40);
    geo.emit(22.46, 18);
    geo.emit(22.46, 25);
    vi.advanceTimersByTime(60_000);
    const { fixes, error } = await run.promise;
    expect(error).toBeNull();
    expect(fixes).toHaveLength(3);
    expect(seen).toEqual([40, 18, 18]);
    expect(geo.clearWatch).toHaveBeenCalledWith(7);
    vi.useRealTimers();
  });

  it('O-09.4 a denied permission ends the session with a reason', async () => {
    const geo = fakeGeo();
    const run = collectFixes(() => {}, 60_000, geo);
    geo.fail(1);
    expect((await run.promise).error).toBe('denied');
  });

  it('keeps at most 200 fixes and tells phones apart', async () => {
    const geo = fakeGeo();
    const run = collectFixes(() => {}, 60_000, geo);
    for (let i = 0; i < MAX_SAMPLES + 20; i++) geo.emit(22.46, 20);
    run.stop();
    expect((await run.promise).fixes).toHaveLength(MAX_SAMPLES);
    expect(platformOf('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe('ios');
    expect(platformOf('Mozilla/5.0 (Linux; Android 14; Redmi Note 12)')).toBe('android');
  });
});
