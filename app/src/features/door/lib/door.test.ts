import { ApiError, fromBase64Url, toBase64Url } from '@fs/contracts';
import { doorStep, doorToken } from '@fs/engine';
import { describe, expect, it } from 'vitest';
import { createDoorClock } from './clock';
import { createMemoryDoorStore } from './store';
import { currentDoorCode, doorUrl } from './token';
import { pairErrorOf } from './use-door';

const SECRET = toBase64Url(new Uint8Array(32).fill(7));

describe('door code (O-10.1)', () => {
  it('O-10.1 shows the token the server accepts for the current step, in the QR URL', async () => {
    const now = 1792386725000;
    const code = await currentDoorCode(SECRET, 'SITE1', now, 'https://staff.example');
    expect(code.token).toBe(await doorToken(fromBase64Url(SECRET), doorStep(now)));
    expect(code.token).toHaveLength(10);
    expect(code.url).toBe(doorUrl('https://staff.example', 'SITE1', code.token));
  });

  it('O-10.2 counts down to the next 30 s step and then shows a new token', async () => {
    const stepStart = doorStep(1792386725000) * 30_000;
    const a = await currentDoorCode(SECRET, 'S', stepStart + 18_000, 'https://x');
    expect(a.secondsLeft).toBe(12);
    const b = await currentDoorCode(SECRET, 'S', stepStart + 30_000, 'https://x');
    expect(b.token).not.toBe(a.token);
    expect(b.secondsLeft).toBe(30);
  });
});

describe('door clock (O-10.3)', () => {
  it('O-10.3 has no time before the first sync, then follows the monotonic clock', () => {
    let perf = 1000;
    const clock = createDoorClock(() => perf);
    expect(clock.now()).toBeNull();
    clock.sync(50_000);
    perf = 4000;
    expect(clock.now()).toBe(53_000);
    expect(clock.synced()).toBe(true);
  });
});

describe('pairing', () => {
  it('maps a refused code to wrong and a dead network to network', () => {
    expect(pairErrorOf(new ApiError({ code: 'NOT_FOUND', status: 404 }))).toBe('wrong');
    expect(pairErrorOf(new ApiError({ code: 'UNAVAILABLE', status: 0 }))).toBe('network');
  });

  it('keeps the pairing in the store and clears it', async () => {
    const store = createMemoryDoorStore();
    await store.set({ doorDeviceId: 'd', siteId: 's', siteName: 'n', secret: SECRET });
    expect((await store.get())?.siteId).toBe('s');
    await store.clear();
    expect(await store.get()).toBeNull();
  });
});
