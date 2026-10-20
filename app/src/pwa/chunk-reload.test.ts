/** Stale-chunk recovery (public/recover.js): one reload per session, only for chunk-load errors. */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import source from '../../public/recover.js?raw';

type Recover = (error?: unknown) => boolean;

function load(storage: Pick<Storage, 'getItem' | 'setItem'>) {
  const listeners: Record<string, (e: { preventDefault(): void }) => void> = {};
  const reload = vi.fn();
  const fakeWindow = {
    sessionStorage: storage,
    navigator: {},
    caches: {
      keys: async () => ['workbox-precache-v2-x', 'api-v1'],
      delete: vi.fn(async () => true),
    },
    location: { reload },
    addEventListener: (name: string, fn: (e: { preventDefault(): void }) => void) => {
      listeners[name] = fn;
    },
  } as unknown as Record<string, unknown>;
  new Function('window', source)(fakeWindow);
  return { recover: fakeWindow.__fsRecover as Recover, listeners, reload, fakeWindow };
}

function memory() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

describe('stale chunk recovery', () => {
  beforeEach(() => vi.useRealTimers());

  it('X-02.9 only chunk-load errors start a recovery', () => {
    const { recover } = load(memory());
    expect(recover(new Error('Network down'))).toBe(false);
    expect(
      recover(new TypeError('Failed to fetch dynamically imported module: /assets/a.js')),
    ).toBe(true);
  });

  it('X-02.9 reloads once per session and deletes only the precached shell', async () => {
    const { recover, listeners, reload, fakeWindow } = load(memory());
    const preventDefault = vi.fn();
    listeners['vite:preloadError']?.({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(recover()).toBe(false);
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
    const del = (fakeWindow.caches as { delete: ReturnType<typeof vi.fn> }).delete;
    expect(del).toHaveBeenCalledWith('workbox-precache-v2-x');
    expect(del).not.toHaveBeenCalledWith('api-v1');
  });

  it('X-02.9 reloads again only after the guard window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const { recover } = load(memory());
    expect(recover()).toBe(true);
    expect(recover()).toBe(false);
    vi.setSystemTime(1_000_000 + 11 * 60 * 1000);
    expect(recover()).toBe(true);
  });

  it('X-02.9 never reloads when storage is unavailable', () => {
    const { recover } = load({
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => undefined,
    });
    expect(recover()).toBe(false);
  });
});
