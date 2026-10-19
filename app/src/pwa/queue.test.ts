/** Offline punch queue (PRD 4.3.6, 11.5; AC S-09). */
import { type ApiClient, ApiError, type PunchRequest, PunchResult } from '@fs/contracts';
import { fixtures } from '@fs/contracts/fixtures';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BACKOFF_MS,
  createMemoryQueueStorage,
  enqueue,
  flush,
  getQueueSnapshot,
  onQueueEvent,
  type QueueEvent,
  removeQueued,
  resetQueueForTests,
  retryQueued,
  setResigner,
  startQueue,
  whenQueueLoaded,
} from './queue';

const RESULT = PunchResult.parse(fixtures.punchCreate);
const T0 = Date.parse('2026-10-19T10:42:00+05:30');

let seq = 0;
function punch(kind: PunchRequest['kind'], extra: Partial<PunchRequest> = {}): PunchRequest {
  seq += 1;
  return {
    v: 1,
    kind,
    nonce: `offline-nonce-${seq}`,
    deviceId: '01JADEVICE0000000000000001',
    clientTs: T0,
    idempotencyKey: `idem-key-${String(seq).padStart(8, '0')}`,
    fix: null,
    selfieSha256: null,
    qrToken: null,
    offsiteDutyId: null,
    placeName: null,
    deviceTz: 'Asia/Kolkata',
    offline: {
      lastServerTime: T0 - 60_000,
      timeSig: 'time-sig',
      perfDeltaMs: 60_000,
      wallDeltaMs: 60_000,
      pinEnvelope: 'sealed-pin-envelope',
    },
    pin: null,
    clientDurationMs: 4_000,
    requestApproval: false,
    note: null,
    ack: [],
    appVersion: '0.1.0',
    signature: 'signature',
    ...extra,
  };
}

type Answer = (body: PunchRequest) => Promise<PunchResult>;
function fakeApi(answer: Answer = async () => RESULT) {
  const punchCreate = vi.fn(
    async (
      input: { body: PunchRequest; files?: Record<string, Blob> },
      _opts?: { idempotencyKey?: string },
    ) => answer(input.body),
  );
  return { api: { punchCreate } as unknown as ApiClient, punchCreate };
}

const err = (code: ApiError['code'], status: number) => new ApiError({ code, status });

/** The real timer, captured before fake timers replace it. */
const realSetTimeout = globalThis.setTimeout;

/** Let every pending promise chain settle (storage and flush are async). */
async function settle(): Promise<void> {
  await new Promise<void>((resolve) => realSetTimeout(resolve, 0));
}

let online = true;
let visibility: DocumentVisibilityState = 'visible';
let storage = createMemoryQueueStorage();

/** Start the triggers while offline (nothing is sent), then come back online without the event. */
async function startWhileOffline(api: ApiClient): Promise<void> {
  online = false;
  startQueue(api);
  await settle();
  online = true;
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
  });
  vi.setSystemTime(T0);
  online = true;
  visibility = 'visible';
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  });
  storage = createMemoryQueueStorage();
  resetQueueForTests(storage);
});

afterEach(() => {
  resetQueueForTests();
  vi.useRealTimers();
});

describe('enqueue', () => {
  it('S-09.1 an offline punch is stored with its sealed PIN and shown as waiting', async () => {
    online = false;
    const { api, punchCreate } = fakeApi();
    startQueue(api);
    const selfie = new Blob(['jpeg'], { type: 'image/jpeg' });
    const item = await enqueue(punch('in'), selfie);
    await settle();

    expect(item.status).toBe('waiting');
    expect(getQueueSnapshot()).toMatchObject({ waiting: 1, failed: 0 });
    const stored = storage.records.get(item.idempotencyKey);
    expect(stored?.request.pin).toBeNull();
    expect(stored?.request.offline?.pinEnvelope).toBe('sealed-pin-envelope');
    expect(stored?.selfie).toBe(selfie);
    expect(stored?.failed).toBe(false);
    expect(punchCreate).not.toHaveBeenCalled();
  });

  it('S-09.4 a punch with a plaintext PIN is refused and nothing is stored', async () => {
    await expect(enqueue(punch('in', { pin: '4821' }))).rejects.toThrow(/plaintext PIN/);
    expect(storage.records.size).toBe(0);
    expect(getQueueSnapshot().items).toHaveLength(0);
  });

  it('S-09.1 queued punches are read back from IndexedDB after a reload', async () => {
    online = false;
    const first = await enqueue(punch('in'));
    resetQueueForTests(storage);
    await whenQueueLoaded();
    expect(getQueueSnapshot().items.map((i) => i.idempotencyKey)).toEqual([first.idempotencyKey]);
    expect(getQueueSnapshot().items[0]?.enqueuedAt).toBe(T0);
  });
});

describe('flush', () => {
  it('S-09.2 sends in FIFO order: the in goes before the out, each with its idempotency key', async () => {
    online = false;
    const inPunch = await enqueue(punch('in'));
    const outPunch = await enqueue(punch('out'));
    const events: QueueEvent[] = [];
    onQueueEvent((e) => events.push(e));
    const { api, punchCreate } = fakeApi();
    await startWhileOffline(api);
    await flush();

    expect(punchCreate.mock.calls.map(([input]) => input.body.kind)).toEqual(['in', 'out']);
    expect(punchCreate.mock.calls.map(([, opts]) => opts?.idempotencyKey)).toEqual([
      inPunch.idempotencyKey,
      outPunch.idempotencyKey,
    ]);
    expect(events.map((e) => e.type)).toEqual(['synced', 'synced']);
    expect(storage.records.size).toBe(0);
    expect(getQueueSnapshot()).toMatchObject({ waiting: 0, failed: 0, lastSyncedAt: T0 });
  });

  it('S-09.2 the out waits until the in is accepted', async () => {
    online = false;
    await enqueue(punch('in'));
    await enqueue(punch('out'));
    let down = true;
    const { api, punchCreate } = fakeApi(async () => {
      if (down) throw err('UNAVAILABLE', 503);
      return RESULT;
    });
    await startWhileOffline(api);
    await flush();
    expect(punchCreate).toHaveBeenCalledTimes(1);
    expect(getQueueSnapshot().items.map((i) => i.status)).toEqual(['waiting', 'waiting']);

    down = false;
    await flush();
    expect(punchCreate.mock.calls.map(([input]) => input.body.kind)).toEqual(['in', 'in', 'out']);
    expect(getQueueSnapshot().items).toHaveLength(0);
  });

  it('S-09.2 a 2xx deletes the record with its selfie and emits synced with the result', async () => {
    online = false;
    const selfie = new Blob(['jpeg'], { type: 'image/jpeg' });
    const item = await enqueue(punch('in'), selfie);
    const events: QueueEvent[] = [];
    onQueueEvent((e) => events.push(e));
    const { api, punchCreate } = fakeApi();
    await startWhileOffline(api);
    await flush();

    expect(punchCreate.mock.calls[0]?.[0].files).toEqual({ selfie });
    expect(storage.records.has(item.idempotencyKey)).toBe(false);
    expect(events).toEqual([
      {
        type: 'synced',
        item: expect.objectContaining({ idempotencyKey: item.idempotencyKey }),
        result: RESULT,
      },
    ]);
  });

  it('S-09.2 network and server errors back off 30 s, 2 min, then 5 min, and keep the item', async () => {
    online = false;
    await enqueue(punch('in'));
    const { api, punchCreate } = fakeApi(async () => {
      throw err('UNAVAILABLE', 0);
    });
    online = true;
    startQueue(api);
    await settle();
    expect(punchCreate).toHaveBeenCalledTimes(1);
    expect(getQueueSnapshot().items[0]?.nextAttemptAt).toBe(T0 + BACKOFF_MS[0]);

    await vi.advanceTimersByTimeAsync(29_000);
    await settle();
    expect(punchCreate).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    await settle();
    expect(punchCreate).toHaveBeenCalledTimes(2);
    expect(getQueueSnapshot().items[0]?.nextAttemptAt).toBe(T0 + 30_000 + 120_000);

    await vi.advanceTimersByTimeAsync(119_000);
    await settle();
    expect(punchCreate).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_000);
    await settle();
    expect(punchCreate).toHaveBeenCalledTimes(3);
    expect(getQueueSnapshot().items[0]?.nextAttemptAt).toBe(T0 + 150_000 + 300_000);

    await vi.advanceTimersByTimeAsync(300_000);
    await settle();
    expect(punchCreate).toHaveBeenCalledTimes(4);
    expect(getQueueSnapshot().items[0]?.nextAttemptAt).toBe(T0 + 450_000 + 300_000);
    expect(getQueueSnapshot().items[0]).toMatchObject({ status: 'waiting', attempts: 4 });
  });

  it('S-09.2 a rejected item is marked failed and stops the chain', async () => {
    online = false;
    const first = await enqueue(punch('in'));
    await enqueue(punch('out'));
    const events: QueueEvent[] = [];
    onQueueEvent((e) => events.push(e));
    const { api, punchCreate } = fakeApi(async (body) => {
      if (body.kind === 'in') throw err('DEVICE_NOT_APPROVED', 403);
      return RESULT;
    });
    await startWhileOffline(api);
    await flush();

    expect(punchCreate).toHaveBeenCalledTimes(1);
    expect(getQueueSnapshot()).toMatchObject({ waiting: 1, failed: 1 });
    expect(getQueueSnapshot().items[0]?.lastError).toMatchObject({
      code: 'DEVICE_NOT_APPROVED',
      status: 403,
    });
    expect(storage.records.get(first.idempotencyKey)?.failed).toBe(true);
    expect(events).toEqual([
      {
        type: 'failed',
        item: expect.objectContaining({ status: 'failed' }),
        error: expect.objectContaining({ code: 'DEVICE_NOT_APPROVED' }),
      },
    ]);

    await flush();
    expect(punchCreate).toHaveBeenCalledTimes(1);

    await removeQueued(first.idempotencyKey);
    await flush();
    expect(punchCreate.mock.calls.map(([input]) => input.body.kind)).toEqual(['in', 'out']);
    expect(getQueueSnapshot().items).toHaveLength(0);
  });

  it('S-09.2 retrying a failed item sends it again', async () => {
    online = false;
    const item = await enqueue(punch('in'));
    let reject = true;
    const { api, punchCreate } = fakeApi(async () => {
      if (reject) throw err('RULE_VIOLATION', 422);
      return RESULT;
    });
    await startWhileOffline(api);
    await flush();
    expect(getQueueSnapshot().failed).toBe(1);

    reject = false;
    await retryQueued(item.idempotencyKey);
    expect(punchCreate).toHaveBeenCalledTimes(2);
    expect(getQueueSnapshot().items).toHaveLength(0);
  });

  it('S-09.2 401 keeps the item and waits for sign-in before sending again', async () => {
    online = false;
    await enqueue(punch('in'));
    let signedIn = false;
    const { api, punchCreate } = fakeApi(async () => {
      if (!signedIn) throw err('UNAUTHENTICATED', 401);
      return RESULT;
    });
    online = true;
    startQueue(api);
    await settle();
    expect(punchCreate).toHaveBeenCalledTimes(1);
    expect(getQueueSnapshot().items[0]).toMatchObject({
      status: 'waiting',
      lastError: { code: 'UNAUTHENTICATED', status: 401 },
    });

    await vi.advanceTimersByTimeAsync(90_000);
    await settle();
    expect(punchCreate).toHaveBeenCalledTimes(1);

    signedIn = true;
    await flush();
    expect(punchCreate).toHaveBeenCalledTimes(2);
    expect(getQueueSnapshot().items).toHaveLength(0);
  });

  it('S-09.2 426 keeps the item for after the app update', async () => {
    online = false;
    await enqueue(punch('in'));
    const { api } = fakeApi(async () => {
      throw err('UPGRADE_REQUIRED', 426);
    });
    await startWhileOffline(api);
    await flush();
    expect(getQueueSnapshot()).toMatchObject({ waiting: 1, failed: 0 });
  });

  it('S-09.2 NONCE_INVALID re-signs once and resends with the same idempotency key', async () => {
    online = false;
    const item = await enqueue(punch('in'));
    const resigner = vi.fn(async (q: { request: PunchRequest }) => ({
      ...q.request,
      nonce: 'fresh-offline-nonce',
      signature: 'new-signature',
    }));
    setResigner(resigner);
    const { api, punchCreate } = fakeApi(async (body) => {
      if (body.nonce !== 'fresh-offline-nonce') throw err('NONCE_INVALID', 409);
      return RESULT;
    });
    await startWhileOffline(api);
    await flush();

    expect(resigner).toHaveBeenCalledTimes(1);
    expect(punchCreate).toHaveBeenCalledTimes(2);
    expect(punchCreate.mock.calls[1]?.[0].body.nonce).toBe('fresh-offline-nonce');
    expect(punchCreate.mock.calls[1]?.[1]?.idempotencyKey).toBe(item.idempotencyKey);
    expect(getQueueSnapshot().items).toHaveLength(0);
  });

  it('S-09.2 a second NONCE_INVALID after re-signing marks the item failed', async () => {
    online = false;
    await enqueue(punch('in'));
    const resigner = vi.fn(async (q: { request: PunchRequest }) => q.request);
    setResigner(resigner);
    const { api, punchCreate } = fakeApi(async () => {
      throw err('NONCE_INVALID', 409);
    });
    await startWhileOffline(api);
    await flush();

    expect(resigner).toHaveBeenCalledTimes(1);
    expect(punchCreate).toHaveBeenCalledTimes(2);
    expect(getQueueSnapshot().items[0]).toMatchObject({
      status: 'failed',
      lastError: { code: 'NONCE_INVALID' },
    });
  });

  it('S-09.2 NONCE_INVALID without a re-signer marks the item failed', async () => {
    online = false;
    await enqueue(punch('in'));
    const { api } = fakeApi(async () => {
      throw err('NONCE_INVALID', 409);
    });
    await startWhileOffline(api);
    await flush();
    expect(getQueueSnapshot().failed).toBe(1);
  });

  it('S-09.4 a re-signed request that carries a plaintext PIN is never stored', async () => {
    online = false;
    const item = await enqueue(punch('in'));
    setResigner(async (q) => ({ ...q.request, pin: '4821' }));
    const { api } = fakeApi(async () => {
      throw err('NONCE_INVALID', 409);
    });
    await startWhileOffline(api);
    await flush();
    expect(storage.records.get(item.idempotencyKey)?.request.pin).toBeNull();
    expect(getQueueSnapshot().failed).toBe(1);
  });

  it('S-09.2 only one flush runs at a time', async () => {
    online = false;
    await enqueue(punch('in'));
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { api, punchCreate } = fakeApi(async () => {
      await gate;
      return RESULT;
    });
    await startWhileOffline(api);
    const a = flush();
    const b = flush();
    await settle();
    expect(getQueueSnapshot().flushing).toBe(true);
    expect(getQueueSnapshot().items[0]?.status).toBe('sending');
    release();
    await Promise.all([a, b]);
    expect(punchCreate).toHaveBeenCalledTimes(1);
    expect(getQueueSnapshot().flushing).toBe(false);
  });
});

describe('triggers', () => {
  it('S-09.2 syncs on app open, on reconnect (resetting the back-off) and when the app becomes visible', async () => {
    online = false;
    await enqueue(punch('in'));
    let down = true;
    const { api, punchCreate } = fakeApi(async () => {
      if (down) throw err('UNAVAILABLE', 503);
      return RESULT;
    });
    online = true;
    startQueue(api);
    await settle();
    expect(punchCreate).toHaveBeenCalledTimes(1);

    down = false;
    window.dispatchEvent(new Event('online'));
    await settle();
    expect(punchCreate).toHaveBeenCalledTimes(2);
    expect(getQueueSnapshot().items).toHaveLength(0);

    online = false;
    await enqueue(punch('out'));
    online = true;
    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(punchCreate).toHaveBeenCalledTimes(2);
    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(punchCreate).toHaveBeenCalledTimes(3);
    expect(getQueueSnapshot().items).toHaveLength(0);
  });

  it('S-09.2 flushes every 30 s while the app is open', async () => {
    online = false;
    await enqueue(punch('in'));
    const { api, punchCreate } = fakeApi();
    startQueue(api);
    await settle();
    expect(punchCreate).not.toHaveBeenCalled();
    online = true;
    await vi.advanceTimersByTimeAsync(30_000);
    await settle();
    expect(punchCreate).toHaveBeenCalledTimes(1);
  });

  it('S-09.2 startQueue is idempotent and the stop function removes every trigger', async () => {
    const { api, punchCreate } = fakeApi();
    const stop = startQueue(api);
    expect(startQueue(api)).toBe(stop);
    stop();
    online = false;
    await enqueue(punch('in'));
    online = true;
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(60_000);
    await settle();
    expect(punchCreate).not.toHaveBeenCalled();
  });
});
