/**
 * Service worker registration and the update flow (PRD 11.7). Owner: WP-7.
 * `startPwa()` is called once by the app (main.tsx); the staff shell and the owner panel render
 * the "new version" toast from `useUpdateState()` and call `applyUpdate()` on tap.
 *
 * - Registers `/sw.js` (scope `/`) only in production builds with service worker support.
 * - Checks for updates when the app becomes visible and every 60 minutes.
 * - `needRefresh` is set while a new worker is waiting (or another tab already switched to it).
 * - The prompt and the reload wait while any update blocker is set (the check-in sheet registers
 *   one) or punches are queued. `applyUpdate()` posts SKIP_WAITING and reloads once the new worker
 *   controls the page.
 * - `fs:upgrade-required` (the HTTP client on 426) sets `upgradeRequired` and checks right away.
 *
 * Differences from the WP-7 brief, on purpose:
 * - Uses the ServiceWorker API directly instead of workbox-window: smaller, and workbox-window
 *   treats an update found more than 60 s after registration as "external" and stops listening
 *   after the first one, which the hourly checks would hit.
 * - Once the server answered 426 (`upgradeRequired`), `applyUpdate()` also runs while punches are
 *   queued: this version can no longer send them, and the queue is durable in IndexedDB, so it
 *   resends after the reload. Update blockers still hold it.
 */
import { useSyncExternalStore } from 'react';
import { startOfflineWatch } from './offline';
import { SKIP_WAITING_MESSAGE } from './protocol';
import {
  getQueueSnapshot,
  removeQueued,
  subscribe as subscribeQueue,
  whenQueueLoaded,
} from './queue';

export interface UpdateState {
  needRefresh: boolean;
  /** needRefresh && no blockers && the punch queue is empty (and known to be). */
  canPromptNow: boolean;
  upgradeRequired: boolean;
}

/** What the update flow needs from the browser; tests pass fakes. */
export interface PwaEnv {
  container: ServiceWorkerContainer | null;
  reload: () => void;
  /** Register a service worker at all (production builds only). */
  enabled: boolean;
  scriptUrl?: string;
  /** Check for updates this often (ms). */
  checkEveryMs?: number;
  /** Register after the window `load` event, so the SW install does not compete with the page. */
  waitForLoad?: boolean;
}

export const UPDATE_CHECK_EVERY_MS = 60 * 60 * 1000;
const UPGRADE_WAIT_MS = 10_000;

const blockers = new Set<string>();
const listeners = new Set<() => void>();
const waiters = new Set<() => void>();
let state: UpdateState = { needRefresh: false, canPromptNow: false, upgradeRequired: false };
let upgradeRequired = false;
let queueKnownEmpty = false;
let listening = false;
let started = false;
let env: PwaEnv | null = null;
let registration: ServiceWorkerRegistration | null = null;
let lastController: ServiceWorker | null = null;
/** Another tab activated a newer worker: this page runs old code under it. */
let controllerReplaced = false;
let reloadRequested = false;
let pendingReload = false;
let reloaded = false;
let cleanups: Array<() => void> = [];

function browserEnv(): PwaEnv {
  const container =
    typeof navigator !== 'undefined' && 'serviceWorker' in navigator
      ? navigator.serviceWorker
      : null;
  return {
    container,
    reload: () => window.location.reload(),
    enabled: import.meta.env.PROD && container !== null,
    waitForLoad: true,
  };
}

function reloadPage(): void {
  (env ?? browserEnv()).reload();
}

/** Blockers or queued punches hold the prompt and any reload (queued punches not after a 426). */
function held(): boolean {
  return blockers.size > 0 || (!queueKnownEmpty && !upgradeRequired);
}

function recompute(): void {
  const needRefresh = controllerReplaced || Boolean(registration?.waiting && registration.active);
  const next: UpdateState = {
    needRefresh,
    canPromptNow: needRefresh && blockers.size === 0 && queueKnownEmpty,
    upgradeRequired,
  };
  for (const w of [...waiters]) w();
  if (
    next.needRefresh === state.needRefresh &&
    next.canPromptNow === state.canPromptNow &&
    next.upgradeRequired === state.upgradeRequired
  )
    return;
  state = next;
  for (const l of listeners) l();
}

function maybeReload(): void {
  if (!pendingReload || reloaded || held()) return;
  reloaded = true;
  reloadPage();
}

function ensureListening(): void {
  if (listening) return;
  listening = true;
  const onUpgrade = () => {
    upgradeRequired = true;
    recompute();
    maybeReload();
    void checkForUpdate();
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('fs:upgrade-required', onUpgrade);
    cleanups.push(() => window.removeEventListener('fs:upgrade-required', onUpgrade));
  }
  const unsubscribe = subscribeQueue(() => {
    void whenQueueLoaded().then(syncQueue);
  });
  cleanups.push(unsubscribe);
  void whenQueueLoaded().then(syncQueue);
}

function syncQueue(): void {
  queueKnownEmpty = getQueueSnapshot().items.length === 0;
  recompute();
  maybeReload();
}

function watchRegistration(reg: ServiceWorkerRegistration): void {
  const onUpdateFound = () => {
    const sw = reg.installing;
    if (!sw) return;
    sw.addEventListener('statechange', recompute);
  };
  reg.addEventListener('updatefound', onUpdateFound);
  cleanups.push(() => reg.removeEventListener('updatefound', onUpdateFound));
}

function onControllerChange(): void {
  const container = env?.container;
  const previous = lastController;
  lastController = container?.controller ?? null;
  if (reloadRequested) {
    pendingReload = true;
    maybeReload();
    return;
  }
  // From no controller to one is the first install (clientsClaim), not an update.
  if (previous) controllerReplaced = true;
  recompute();
}

async function start(next: PwaEnv): Promise<void> {
  ensureListening();
  startOfflineWatch();
  if (started || !next.enabled || !next.container) return;
  started = true;
  env = next;
  const container = next.container;
  lastController = container.controller;
  container.addEventListener('controllerchange', onControllerChange);
  cleanups.push(() => container.removeEventListener('controllerchange', onControllerChange));

  if (next.waitForLoad && document.readyState !== 'complete')
    await new Promise((resolve) => window.addEventListener('load', resolve, { once: true }));
  try {
    registration = await container.register(next.scriptUrl ?? '/sw.js', {
      scope: '/',
      updateViaCache: 'none',
    });
  } catch {
    return; // Unsupported or blocked (private mode, insecure origin): the app works without it.
  }
  watchRegistration(registration);
  recompute();

  const onVisibility = () => {
    if (document.visibilityState === 'visible') void checkForUpdate();
  };
  document.addEventListener('visibilitychange', onVisibility);
  const interval = setInterval(
    () => void checkForUpdate(),
    next.checkEveryMs ?? UPDATE_CHECK_EVERY_MS,
  );
  cleanups.push(() => {
    document.removeEventListener('visibilitychange', onVisibility);
    clearInterval(interval);
  });
  exposeTestHooks();
}

/** E2E (localhost only): read the update state and drive the flow from Playwright. */
function exposeTestHooks(): void {
  if (typeof window === 'undefined' || window.location.hostname !== 'localhost') return;
  (window as unknown as { __fsPwa?: unknown }).__fsPwa = {
    state: getUpdateState,
    queue: getQueueSnapshot,
    checkForUpdate,
    applyUpdate,
    removeQueued,
    setUpdateBlocker,
  };
}

function waitForWaiting(ms: number): Promise<ServiceWorker | null> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    function done(sw: ServiceWorker | null) {
      clearTimeout(timer);
      waiters.delete(check);
      resolve(sw);
    }
    function check() {
      const waiting = registration?.waiting;
      if (waiting) done(waiting);
    }
    timer = setTimeout(() => done(registration?.waiting ?? null), ms);
    waiters.add(check);
    check();
  });
}

// ---- Public API ----------------------------------------------------------------------------------

/** Idempotent; registers nothing in dev or without service worker support. */
export function startPwa(): void {
  void start(browserEnv());
}

/** e.g. `setUpdateBlocker('punch-sheet', true)` while the check-in sheet is open. */
export function setUpdateBlocker(key: string, blocked: boolean): void {
  if (blocked) blockers.add(key);
  else blockers.delete(key);
  recompute();
  maybeReload();
}

export function getUpdateState(): UpdateState {
  return state;
}

function subscribeUpdate(listener: () => void): () => void {
  ensureListening();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useUpdateState(): UpdateState {
  return useSyncExternalStore(subscribeUpdate, getUpdateState, getUpdateState);
}

export async function checkForUpdate(): Promise<void> {
  try {
    await registration?.update();
  } catch {
    // Offline or the script failed to load: the next check tries again.
  }
}

/** SKIP_WAITING, then reload once the new worker controls the page. No-op while held. */
export async function applyUpdate(): Promise<void> {
  if (held()) return;
  if (!registration) {
    // No service worker (dev, unsupported browser): only a 426 needs a fresh page.
    if (upgradeRequired) {
      pendingReload = true;
      maybeReload();
    }
    return;
  }
  let waiting = registration.waiting;
  if (!waiting && (controllerReplaced || upgradeRequired)) {
    if (upgradeRequired && !controllerReplaced) {
      await checkForUpdate();
      waiting = await waitForWaiting(UPGRADE_WAIT_MS);
    }
    if (!waiting) {
      pendingReload = true;
      maybeReload();
      return;
    }
  }
  if (!waiting || held()) return;
  const sw = waiting;
  reloadRequested = true;
  sw.addEventListener('statechange', () => {
    if (sw.state === 'activated') {
      pendingReload = true;
      maybeReload();
    }
  });
  sw.postMessage({ type: SKIP_WAITING_MESSAGE });
}

// ---- Tests ---------------------------------------------------------------------------------------

/** Unit tests: start with a fake environment and wait for registration. */
export function startPwaWith(next: PwaEnv): Promise<void> {
  return start(next);
}

/** Unit tests: forget all state and listeners. */
export function resetPwaForTests(): void {
  for (const c of cleanups) c();
  cleanups = [];
  blockers.clear();
  listeners.clear();
  waiters.clear();
  state = { needRefresh: false, canPromptNow: false, upgradeRequired: false };
  upgradeRequired = false;
  queueKnownEmpty = false;
  listening = false;
  started = false;
  env = null;
  registration = null;
  lastController = null;
  controllerReplaced = false;
  reloadRequested = false;
  pendingReload = false;
  reloaded = false;
}
