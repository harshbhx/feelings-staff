/**
 * Offline punch queue (PRD 4.3.6, 11.5). Owner: WP-7.
 * WP-4's punch flow calls `enqueue`; the staff shell calls `startQueue(api)` and renders `useQueue()`.
 *
 * Records live in IndexedDB `feelings` / `pendingPunches` (WP-3's `openFeelingsDb`, key
 * `idempotencyKey`). The stored shape is WP-3's `PendingPunch`; this module maps it to the public
 * `QueuedPunch`:
 *   enqueuedAt <-> createdAt, status 'failed' <-> failed: true ('sending' exists only in memory),
 *   lastError.message '' <-> undefined. `lastError.requestId` is kept in memory only.
 *
 * Flush (PRD 11.5): strict FIFO by `enqueuedAt`, one flush at a time.
 * - 2xx: delete the record (and with it the selfie blob), emit `synced`.
 * - 409 NONCE_INVALID: ask the re-signer once for a fresh nonce (same idempotencyKey) and resend;
 *   otherwise mark failed.
 * - 401 UNAUTHENTICATED (session gone) or 426 (app too old): keep it, stop, and pause automatic
 *   flushes until `flush()` is called (after sign-in) or the page reloads (after the update).
 * - Any other 4xx: mark failed, emit `failed`, stop. A failed item holds back the ones after it
 *   (an `out` never goes before its `in`) until it is retried or removed.
 * - 5xx, 408, 429, network errors: back off 30 s, 2 min, then 5 min, and keep it.
 * `attempts` counts failed sends since the last back-off reset (the `online` event resets it).
 */
import type { ApiClient, ErrorCode, PunchRequest, PunchResult } from '@fs/contracts';
import { useSyncExternalStore } from 'react';
import { openFeelingsDb, type PendingPunch } from '../lib/idb';

export type QueueItemStatus = 'waiting' | 'sending' | 'failed';
export interface QueueError {
  code: ErrorCode;
  status: number;
  message?: string;
  requestId?: string;
}
export interface QueuedPunch {
  idempotencyKey: string;
  /** Fully signed; `request.pin` is always null (sealed in `request.offline.pinEnvelope`). */
  request: PunchRequest;
  selfie: Blob | null;
  /** Date.now() when queued (strictly increasing, so FIFO order is stable). */
  enqueuedAt: number;
  attempts: number;
  nextAttemptAt: number;
  status: QueueItemStatus;
  lastError: QueueError | null;
}
export interface QueueSnapshot {
  /** FIFO order. */
  items: QueuedPunch[];
  /** Items with status waiting or sending. */
  waiting: number;
  failed: number;
  flushing: boolean;
  lastSyncedAt: number | null;
}
export type QueueEvent =
  | { type: 'synced'; item: QueuedPunch; result: PunchResult }
  | { type: 'failed'; item: QueuedPunch; error: QueueError };

/** Where records are kept. IndexedDB in the app; an in-memory map in unit tests. */
export interface QueueStorage {
  list(): Promise<PendingPunch[]>;
  put(record: PendingPunch): Promise<void>;
  remove(idempotencyKey: string): Promise<void>;
}

export const BACKOFF_MS = [30_000, 120_000, 300_000] as const;
export const FLUSH_EVERY_MS = 30_000;

// ---- Storage -------------------------------------------------------------------------------------

export const idbQueueStorage: QueueStorage = {
  async list() {
    return (await openFeelingsDb()).getAll('pendingPunches');
  },
  async put(record) {
    await (await openFeelingsDb()).put('pendingPunches', record);
  },
  async remove(idempotencyKey) {
    await (await openFeelingsDb()).delete('pendingPunches', idempotencyKey);
  },
};

/** In-memory storage for unit tests (happy-dom has no IndexedDB). */
export function createMemoryQueueStorage(): QueueStorage & { records: Map<string, PendingPunch> } {
  const records = new Map<string, PendingPunch>();
  return {
    records,
    async list() {
      return [...records.values()].map((r) => ({ ...r }));
    },
    async put(record) {
      records.set(record.idempotencyKey, { ...record });
    },
    async remove(idempotencyKey) {
      records.delete(idempotencyKey);
    },
  };
}

function fromRecord(r: PendingPunch): QueuedPunch {
  return {
    idempotencyKey: r.idempotencyKey,
    request: r.request,
    selfie: r.selfie ?? null,
    enqueuedAt: r.createdAt,
    attempts: r.attempts ?? 0,
    nextAttemptAt: r.nextAttemptAt ?? 0,
    status: r.failed ? 'failed' : 'waiting',
    lastError: r.lastError
      ? {
          code: r.lastError.code as ErrorCode,
          status: r.lastError.status,
          ...(r.lastError.message ? { message: r.lastError.message } : {}),
        }
      : null,
  };
}

function toRecord(q: QueuedPunch): PendingPunch {
  return {
    idempotencyKey: q.idempotencyKey,
    request: q.request,
    selfie: q.selfie,
    attempts: q.attempts,
    lastError: q.lastError
      ? { status: q.lastError.status, code: q.lastError.code, message: q.lastError.message ?? '' }
      : null,
    failed: q.status === 'failed',
    createdAt: q.enqueuedAt,
    nextAttemptAt: q.nextAttemptAt,
  };
}

// ---- State ---------------------------------------------------------------------------------------

let storage: QueueStorage = idbQueueStorage;
let items: QueuedPunch[] = [];
let loaded: Promise<void> | null = null;
let flushing: Promise<void> | null = null;
let lastSyncedAt: number | null = null;
let lastEnqueuedAt = 0;
let api: ApiClient | null = null;
let resigner: ((item: QueuedPunch) => Promise<PunchRequest>) | null = null;
/** Set by 401 (sign in again) or 426 (update the app); automatic flushes wait until cleared. */
let paused: 'auth' | 'upgrade' | null = null;
let stopQueue: (() => void) | null = null;
let wakeTimer: ReturnType<typeof setTimeout> | null = null;
let lock: Promise<unknown> = Promise.resolve();

const listeners = new Set<(s: QueueSnapshot) => void>();
const eventListeners = new Set<(e: QueueEvent) => void>();

function makeSnapshot(): QueueSnapshot {
  let failed = 0;
  for (const i of items) if (i.status === 'failed') failed += 1;
  return {
    items,
    waiting: items.length - failed,
    failed,
    flushing: flushing !== null,
    lastSyncedAt,
  };
}
let snapshot: QueueSnapshot = makeSnapshot();

function publish(): void {
  snapshot = makeSnapshot();
  for (const l of listeners) l(snapshot);
}

function emit(e: QueueEvent): void {
  for (const l of eventListeners) {
    try {
      l(e);
    } catch (err) {
      console.error(err);
    }
  }
}

/** Serialises every read-modify-write of `items` and storage. Network calls stay outside it. */
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const run = lock.then(fn, fn);
  lock = run.catch(() => undefined);
  return run;
}

const byEnqueuedAt = (a: QueuedPunch, b: QueuedPunch) => a.enqueuedAt - b.enqueuedAt;

async function reloadLocked(): Promise<void> {
  try {
    const records = await storage.list();
    items = records.map(fromRecord).sort(byEnqueuedAt);
    for (const i of items) lastEnqueuedAt = Math.max(lastEnqueuedAt, i.enqueuedAt);
  } catch {
    // Storage unavailable (private mode, blocked): keep what this page already knows.
  }
  publish();
}

function ensureLoaded(): Promise<void> {
  loaded ??= locked(reloadLocked);
  return loaded;
}

/** Resolves once the queue has read IndexedDB (register.ts waits for it before prompting). */
export function whenQueueLoaded(): Promise<void> {
  return ensureLoaded();
}

/** Re-read IndexedDB (after sign-out cleared it, or to pick up another tab's writes). */
export function reloadQueue(): Promise<void> {
  loaded = locked(reloadLocked);
  return loaded;
}

async function patchItem(
  idempotencyKey: string,
  patch: Partial<QueuedPunch>,
): Promise<QueuedPunch | null> {
  return locked(async () => {
    const current = items.find((i) => i.idempotencyKey === idempotencyKey);
    if (!current) return null;
    const next: QueuedPunch = { ...current, ...patch };
    await storage.put(toRecord(next));
    items = items.map((i) => (i.idempotencyKey === idempotencyKey ? next : i));
    publish();
    return next;
  });
}

async function dropItem(idempotencyKey: string): Promise<void> {
  await locked(async () => {
    await storage.remove(idempotencyKey);
    items = items.filter((i) => i.idempotencyKey !== idempotencyKey);
    publish();
  });
}

// ---- Errors --------------------------------------------------------------------------------------

function toQueueError(e: unknown): QueueError {
  if (e && typeof e === 'object') {
    const x = e as { code?: unknown; status?: unknown; message?: unknown; requestId?: unknown };
    if (typeof x.code === 'string' && typeof x.status === 'number') {
      return {
        code: x.code as ErrorCode,
        status: x.status,
        ...(typeof x.message === 'string' && x.message ? { message: x.message } : {}),
        ...(typeof x.requestId === 'string' ? { requestId: x.requestId } : {}),
      };
    }
  }
  // Not an ApiError (a thrown TypeError, an abort): treat like a network failure.
  return { code: 'UNAVAILABLE', status: 0 };
}

type Verdict = 'resign' | 'pause' | 'backoff' | 'fail';

function classify(err: QueueError): Verdict {
  if (err.status === 409 && err.code === 'NONCE_INVALID') return 'resign';
  if (err.status === 401 && err.code === 'UNAUTHENTICATED') return 'pause';
  if (err.status === 426 || err.code === 'UPGRADE_REQUIRED') return 'pause';
  if (err.status === 0 || err.status >= 500 || err.status === 408 || err.status === 429)
    return 'backoff';
  if (err.status >= 400) return 'fail';
  return 'backoff';
}

function assertNoPlaintextPin(request: PunchRequest): void {
  if (request.pin !== null && request.pin !== undefined)
    throw new Error(
      'A queued punch must not carry a plaintext PIN (seal it in offline.pinEnvelope)',
    );
}

// ---- Flush ---------------------------------------------------------------------------------------

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function scheduleWake(at: number): void {
  if (!stopQueue) return;
  if (wakeTimer) clearTimeout(wakeTimer);
  wakeTimer = setTimeout(
    () => {
      wakeTimer = null;
      void runFlush(false);
    },
    Math.max(0, at - Date.now()),
  );
}

async function settle(
  item: QueuedPunch,
  error: QueueError,
  verdict: 'pause' | 'backoff' | 'fail',
): Promise<void> {
  const attempts = item.attempts + 1;
  if (verdict === 'pause') {
    paused = error.status === 426 || error.code === 'UPGRADE_REQUIRED' ? 'upgrade' : 'auth';
    await patchItem(item.idempotencyKey, { status: 'waiting', attempts, lastError: error });
    return;
  }
  if (verdict === 'backoff') {
    const delay = BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length) - 1] ?? 300_000;
    const nextAttemptAt = Date.now() + delay;
    await patchItem(item.idempotencyKey, {
      status: 'waiting',
      attempts,
      nextAttemptAt,
      lastError: error,
    });
    scheduleWake(nextAttemptAt);
    return;
  }
  const failed = await patchItem(item.idempotencyKey, {
    status: 'failed',
    attempts,
    lastError: error,
  });
  if (failed) emit({ type: 'failed', item: failed, error });
}

/** Sends one item. Returns true when it was accepted (or removed meanwhile) and the chain goes on. */
async function sendOne(client: ApiClient, head: QueuedPunch): Promise<boolean> {
  let current = await patchItem(head.idempotencyKey, { status: 'sending' });
  if (!current) return true;
  let resigned = false;
  for (;;) {
    try {
      const result = await client.punchCreate(
        { body: current.request, files: current.selfie ? { selfie: current.selfie } : {} },
        { idempotencyKey: current.idempotencyKey },
      );
      await dropItem(current.idempotencyKey);
      lastSyncedAt = Date.now();
      publish();
      emit({ type: 'synced', item: current, result });
      return true;
    } catch (e) {
      const error = toQueueError(e);
      const verdict = classify(error);
      if (verdict !== 'resign') {
        await settle(current, error, verdict);
        return false;
      }
      if (resigned || !resigner) {
        await settle(current, error, 'fail');
        return false;
      }
      resigned = true;
      let request: PunchRequest;
      try {
        request = await resigner(current);
      } catch (re) {
        const reError = toQueueError(re);
        const reVerdict = classify(reError);
        await settle(current, reError, reVerdict === 'resign' ? 'fail' : reVerdict);
        return false;
      }
      if (
        request.idempotencyKey !== current.idempotencyKey ||
        (request.pin !== null && request.pin !== undefined)
      ) {
        await settle(current, { code: 'BAD_REQUEST', status: 0 }, 'fail');
        return false;
      }
      current = await patchItem(current.idempotencyKey, { request });
      if (!current) return true;
    }
  }
}

async function drain(explicit: boolean): Promise<void> {
  for (;;) {
    const client = api;
    if (!client || isOffline()) return;
    if (!explicit && paused) return;
    const head = items[0];
    if (!head || head.status === 'failed') return;
    if (!explicit && head.nextAttemptAt > Date.now()) {
      scheduleWake(head.nextAttemptAt);
      return;
    }
    if (!(await sendOne(client, head))) return;
  }
}

function runFlush(explicit: boolean): Promise<void> {
  if (flushing) return flushing;
  const run = (async () => {
    try {
      if (loaded) await reloadQueue();
      else await ensureLoaded();
      await drain(explicit);
    } finally {
      flushing = null;
      publish();
    }
  })();
  flushing = run;
  publish();
  return run;
}

// ---- Public API ----------------------------------------------------------------------------------

/**
 * Queue a fully signed punch. Rejects (and stores nothing) when `request.pin` is not null.
 * Re-queuing the same idempotencyKey returns the existing item.
 */
export async function enqueue(
  request: PunchRequest,
  selfie: Blob | null = null,
): Promise<QueuedPunch> {
  assertNoPlaintextPin(request);
  await ensureLoaded();
  const item = await locked(async () => {
    const existing = items.find((i) => i.idempotencyKey === request.idempotencyKey);
    if (existing) return existing;
    const enqueuedAt = Math.max(Date.now(), lastEnqueuedAt + 1);
    const q: QueuedPunch = {
      idempotencyKey: request.idempotencyKey,
      request,
      selfie,
      enqueuedAt,
      attempts: 0,
      nextAttemptAt: 0,
      status: 'waiting',
      lastError: null,
    };
    await storage.put(toRecord(q));
    lastEnqueuedAt = enqueuedAt;
    items = [...items, q].sort(byEnqueuedAt);
    publish();
    return q;
  });
  if (api) void runFlush(false);
  return item;
}

/**
 * Send now: ignores the back-off timer and the sign-in pause. Call it after sign-in or from a
 * "try now" action. Resolves when this flush has finished (or joins the one already running).
 */
export function flush(): Promise<void> {
  paused = null;
  return runFlush(true);
}

export function subscribe(listener: (s: QueueSnapshot) => void): () => void {
  listeners.add(listener);
  void ensureLoaded();
  return () => {
    listeners.delete(listener);
  };
}

export function onQueueEvent(listener: (e: QueueEvent) => void): () => void {
  eventListeners.add(listener);
  return () => {
    eventListeners.delete(listener);
  };
}

export function getQueueSnapshot(): QueueSnapshot {
  return snapshot;
}

/** After the person sent a failed item to the owner (or gave up on it). */
export async function removeQueued(idempotencyKey: string): Promise<void> {
  await ensureLoaded();
  await dropItem(idempotencyKey);
}

/** failed -> waiting, then flush now. */
export async function retryQueued(idempotencyKey: string): Promise<void> {
  await ensureLoaded();
  const current = items.find((i) => i.idempotencyKey === idempotencyKey);
  if (!current) return;
  if (current.status === 'failed')
    await patchItem(idempotencyKey, {
      status: 'waiting',
      attempts: 0,
      nextAttemptAt: 0,
      lastError: null,
    });
  await flush();
}

/** WP-4 registers how to re-sign an item with a fresh nonce (same idempotencyKey) after 409 NONCE_INVALID. */
export function setResigner(fn: ((item: QueuedPunch) => Promise<PunchRequest>) | null): void {
  resigner = fn;
}

async function resetBackoff(): Promise<void> {
  await ensureLoaded();
  await locked(async () => {
    const reset = items.map((i) =>
      i.status === 'waiting' && (i.attempts > 0 || i.nextAttemptAt > 0)
        ? { ...i, attempts: 0, nextAttemptAt: 0 }
        : i,
    );
    for (const i of reset) if (!items.includes(i)) await storage.put(toRecord(i));
    items = reset;
    publish();
  });
}

/** Wire triggers (open, online, visible, every 30 s). Returns a stop function. Idempotent. */
export function startQueue(client: ApiClient): () => void {
  api = client;
  if (stopQueue) return stopQueue;
  const onOnline = () => {
    void resetBackoff().then(() => runFlush(false));
  };
  const onVisibility = () => {
    if (document.visibilityState === 'visible') void runFlush(false);
  };
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisibility);
  const interval = setInterval(() => void runFlush(false), FLUSH_EVERY_MS);
  const stop = () => {
    window.removeEventListener('online', onOnline);
    document.removeEventListener('visibilitychange', onVisibility);
    clearInterval(interval);
    if (wakeTimer) clearTimeout(wakeTimer);
    wakeTimer = null;
    api = null;
    stopQueue = null;
  };
  stopQueue = stop;
  void runFlush(false);
  return stop;
}

/** React: useSyncExternalStore over subscribe/getQueueSnapshot. */
export function useQueue(): QueueSnapshot {
  return useSyncExternalStore(subscribe, getQueueSnapshot, getQueueSnapshot);
}

// ---- Tests ---------------------------------------------------------------------------------------

/** Unit tests: swap the storage and forget all state. */
export function resetQueueForTests(next: QueueStorage = createMemoryQueueStorage()): void {
  stopQueue?.();
  storage = next;
  items = [];
  loaded = null;
  flushing = null;
  lastSyncedAt = null;
  lastEnqueuedAt = 0;
  api = null;
  resigner = null;
  paused = null;
  lock = Promise.resolve();
  listeners.clear();
  eventListeners.clear();
  snapshot = makeSnapshot();
}
