/** Stale-chunk recovery guard: one reload per session, only for chunk-load errors. */
import { describe, expect, it } from 'vitest';
import { claimReload, isChunkError, RELOAD_WINDOW_MS } from './chunk-reload';

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

describe('stale chunk recovery', () => {
  it('X-02.9 recognises the chunk-load errors of Chrome, Safari and Firefox', () => {
    expect(
      isChunkError(new TypeError('Failed to fetch dynamically imported module: /assets/a.js')),
    ).toBe(true);
    expect(isChunkError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isChunkError(new Error('error loading dynamically imported module'))).toBe(true);
    expect(isChunkError(new Error('Network down'))).toBe(false);
    expect(isChunkError(undefined)).toBe(false);
  });

  it('X-02.9 reloads once per session, again only after the window', () => {
    const s = fakeStorage();
    expect(claimReload(s, 1_000)).toBe(true);
    expect(claimReload(s, 2_000)).toBe(false);
    expect(claimReload(s, 1_000 + RELOAD_WINDOW_MS)).toBe(true);
  });

  it('X-02.9 never reloads when storage is unavailable', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => undefined,
    };
    expect(claimReload(broken, 1)).toBe(false);
  });
});
