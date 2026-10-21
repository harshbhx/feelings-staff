import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { success, tick, VIBRATE_KEY, warn } from './haptics';

function setReducedMotion(on: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: on && q.includes('reduce'), media: q }));
}

describe('haptics (docs/ui-redesign-plan.md 5a)', () => {
  let vibrate: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    setReducedMotion(false);
    localStorage.removeItem(VIBRATE_KEY);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('tick is 8 ms, success two ticks 90 ms apart, warn one 16 ms buzz', () => {
    tick();
    success();
    warn();
    expect(vibrate.mock.calls).toEqual([[8], [[8, 90, 8]], [16]]);
  });

  it('never vibrates with reduced motion', () => {
    setReducedMotion(true);
    tick();
    success();
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('never vibrates when Vibration is off on this phone', () => {
    localStorage.setItem(VIBRATE_KEY, 'off');
    tick();
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('is a quiet no-op where there is no Vibration API (iOS Safari)', () => {
    Object.defineProperty(navigator, 'vibrate', { value: undefined, configurable: true });
    expect(() => {
      tick();
      warn();
    }).not.toThrow();
  });

  it('never throws when the browser refuses (no matchMedia, storage blocked)', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(() => tick()).not.toThrow();
  });
});
