/** Update flow (PRD 11.7; AC S-09.5, X-02). Fake ServiceWorker objects, no browser. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PendingPunch } from '../lib/idb';
import { createMemoryQueueStorage, removeQueued, resetQueueForTests } from './queue';
import {
  applyUpdate,
  getUpdateState,
  resetPwaForTests,
  setUpdateBlocker,
  startPwaWith,
} from './register';

class FakeWorker extends EventTarget {
  readonly scriptURL = 'http://localhost/sw.js';
  readonly posted: unknown[] = [];
  state: ServiceWorkerState;
  constructor(state: ServiceWorkerState) {
    super();
    this.state = state;
  }
  postMessage(message: unknown): void {
    this.posted.push(message);
  }
  setState(state: ServiceWorkerState): void {
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }
}

class FakeRegistration extends EventTarget {
  active: FakeWorker | null = null;
  waiting: FakeWorker | null = null;
  installing: FakeWorker | null = null;
  readonly update = vi.fn(async () => undefined);
}

class FakeContainer extends EventTarget {
  controller: FakeWorker | null = null;
  readonly registration = new FakeRegistration();
  readonly register = vi.fn(
    async (_url: string, _options?: RegistrationOptions) => this.registration,
  );
}

/** A new version is found, installs and waits (an older worker controls the page). */
function installUpdate(reg: FakeRegistration): FakeWorker {
  const sw = new FakeWorker('installing');
  reg.installing = sw;
  reg.dispatchEvent(new Event('updatefound'));
  reg.installing = null;
  reg.waiting = sw;
  sw.setState('installed');
  return sw;
}

/** The waiting worker takes over (after SKIP_WAITING). */
function activate(container: FakeContainer, sw: FakeWorker): void {
  const reg = container.registration;
  reg.waiting = null;
  reg.active = sw;
  sw.setState('activating');
  container.controller = sw;
  container.dispatchEvent(new Event('controllerchange'));
  sw.setState('activated');
}

const realSetTimeout = globalThis.setTimeout;
async function settle(): Promise<void> {
  await new Promise<void>((resolve) => realSetTimeout(resolve, 0));
}

function queued(idempotencyKey: string): PendingPunch {
  return {
    idempotencyKey,
    request: {} as PendingPunch['request'],
    selfie: null,
    attempts: 1,
    lastError: { status: 403, code: 'DEVICE_NOT_APPROVED', message: '' },
    failed: true,
    createdAt: 1,
    nextAttemptAt: 0,
  };
}

let container: FakeContainer;
let reload: ReturnType<typeof vi.fn>;

async function start(records: PendingPunch[] = [], controlled = true): Promise<void> {
  const storage = createMemoryQueueStorage();
  for (const r of records) await storage.put(r);
  resetQueueForTests(storage);
  container = new FakeContainer();
  if (controlled) {
    const current = new FakeWorker('activated');
    container.controller = current;
    container.registration.active = current;
  }
  reload = vi.fn();
  await startPwaWith({
    container: container as unknown as ServiceWorkerContainer,
    reload: reload as unknown as () => void,
    enabled: true,
  });
  await settle();
}

beforeEach(() => {
  resetPwaForTests();
});

afterEach(() => {
  resetPwaForTests();
  resetQueueForTests();
  vi.useRealTimers();
});

describe('update prompt', () => {
  it('X-02 registers /sw.js with scope / and starts without a prompt', async () => {
    await start();
    expect(container.register).toHaveBeenCalledWith('/sw.js', {
      scope: '/',
      updateViaCache: 'none',
    });
    expect(getUpdateState()).toEqual({
      needRefresh: false,
      canPromptNow: false,
      upgradeRequired: false,
    });
  });

  it('X-02 a waiting worker sets needRefresh and the prompt can show', async () => {
    await start();
    installUpdate(container.registration);
    expect(getUpdateState()).toMatchObject({ needRefresh: true, canPromptNow: true });
  });

  it('X-02 the first install is not an update', async () => {
    await start([], false);
    const first = new FakeWorker('installing');
    container.registration.installing = first;
    container.registration.dispatchEvent(new Event('updatefound'));
    container.registration.installing = null;
    first.setState('installed');
    activate(container, first);
    expect(getUpdateState().needRefresh).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('S-09.5 the update prompt waits while the queue is non-empty', async () => {
    await start([queued('idem-key-00000001')]);
    const sw = installUpdate(container.registration);
    expect(getUpdateState()).toMatchObject({ needRefresh: true, canPromptNow: false });

    await applyUpdate();
    expect(sw.posted).toEqual([]);

    await removeQueued('idem-key-00000001');
    await settle();
    expect(getUpdateState()).toMatchObject({ needRefresh: true, canPromptNow: true });
  });

  it('S-09.5 an update blocker (the check-in sheet) holds the prompt until it is released', async () => {
    await start();
    setUpdateBlocker('punch-sheet', true);
    installUpdate(container.registration);
    expect(getUpdateState().canPromptNow).toBe(false);
    setUpdateBlocker('punch-sheet', false);
    expect(getUpdateState().canPromptNow).toBe(true);
  });

  it('X-02 Update posts SKIP_WAITING and reloads once the new worker controls the page', async () => {
    await start();
    const sw = installUpdate(container.registration);
    await applyUpdate();
    expect(sw.posted).toEqual([{ type: 'SKIP_WAITING' }]);
    expect(reload).not.toHaveBeenCalled();
    activate(container, sw);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('S-09.5 the reload waits while a blocker is set after Update was tapped', async () => {
    await start();
    const sw = installUpdate(container.registration);
    await applyUpdate();
    setUpdateBlocker('punch-sheet', true);
    activate(container, sw);
    expect(reload).not.toHaveBeenCalled();
    setUpdateBlocker('punch-sheet', false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('X-02 another tab switching to the new version offers the update here too', async () => {
    await start();
    const sw = installUpdate(container.registration);
    activate(container, sw);
    expect(getUpdateState()).toMatchObject({ needRefresh: true, canPromptNow: true });
    await applyUpdate();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('update checks', () => {
  it('X-02 fs:upgrade-required sets upgradeRequired and checks for an update at once', async () => {
    await start();
    window.dispatchEvent(new CustomEvent('fs:upgrade-required'));
    expect(getUpdateState().upgradeRequired).toBe(true);
    expect(container.registration.update).toHaveBeenCalledTimes(1);
  });

  it('X-02 after a 426 the update runs even with queued punches (they resend after the reload)', async () => {
    await start([queued('idem-key-00000002')]);
    const sw = installUpdate(container.registration);
    window.dispatchEvent(new CustomEvent('fs:upgrade-required'));
    await applyUpdate();
    expect(sw.posted).toEqual([{ type: 'SKIP_WAITING' }]);
  });

  it('X-02 checks for updates when the app becomes visible and every hour', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    await start();
    const update = container.registration.update;
    expect(update).not.toHaveBeenCalled();
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(update).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(update).toHaveBeenCalledTimes(2);
  });
});
