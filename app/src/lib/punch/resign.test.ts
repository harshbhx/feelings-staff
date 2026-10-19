/** Re-signing a queued punch after a rejected nonce (PRD 4.3.6, 11.5; AC S-09.2). */
import { type ApiClient, ApiError, type PunchRequest, PunchResult } from '@fs/contracts';
import { fixtures } from '@fs/contracts/fixtures';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMemoryQueueStorage,
  enqueue,
  flush,
  getQueueSnapshot,
  resetQueueForTests,
  setResigner,
  startQueue,
} from '../../pwa/queue';
import type { PunchSigner } from './deps';
import { punchSigningMessage } from './payload';
import { createPunchResigner } from './resign';

const RESULT = PunchResult.parse(fixtures.punchCreate);
const realSetTimeout = globalThis.setTimeout;
const settle = () => new Promise<void>((resolve) => realSetTimeout(resolve, 0));

const original: PunchRequest = {
  v: 1,
  kind: 'in',
  nonce: 'stale-offline-nonce',
  deviceId: '01JADEVICE0000000000000001',
  clientTs: Date.parse('2026-10-19T10:42:00+05:30'),
  idempotencyKey: 'idem-key-00000001',
  fix: null,
  selfieSha256: null,
  qrToken: null,
  offsiteDutyId: null,
  placeName: null,
  deviceTz: 'Asia/Kolkata',
  offline: {
    lastServerTime: Date.parse('2026-10-19T10:41:00+05:30'),
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
  signature: 'old-signature',
};

const signer: PunchSigner = {
  deviceId: original.deviceId,
  sign: async (m) => `sig:${m.length}`,
};

function apis() {
  const punchNonce = vi.fn(async () => ({ nonce: 'fresh-nonce' }));
  const punchCreate = vi.fn(async (input: { body: PunchRequest }) => {
    if (input.body.nonce !== 'fresh-nonce') {
      throw new ApiError({ code: 'NONCE_INVALID', status: 409 });
    }
    return RESULT;
  });
  return { punchNonce, punchCreate, api: { punchNonce, punchCreate } as unknown as ApiClient };
}

describe('createPunchResigner', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
    resetQueueForTests(createMemoryQueueStorage());
  });
  afterEach(() => {
    resetQueueForTests();
  });

  it('S-09.2 a fresh nonce and a new signature, everything else kept', async () => {
    const { api, punchNonce } = apis();
    const resign = createPunchResigner({ api, getSigner: async () => signer });
    const out = await resign({ request: original });
    expect(punchNonce).toHaveBeenCalledWith({ body: { purpose: 'punch' } });
    expect(out).toEqual({
      ...original,
      nonce: 'fresh-nonce',
      signature: `sig:${punchSigningMessage({ ...original, nonce: 'fresh-nonce' }).length}`,
    });
    expect(out.idempotencyKey).toBe(original.idempotencyKey);
    expect(out.offline?.pinEnvelope).toBe('sealed-pin-envelope');
    expect(out.pin).toBeNull();
  });

  it('S-09.2 409 NONCE_INVALID on a queued punch is re-signed once and resent', async () => {
    const { api, punchCreate, punchNonce } = apis();
    setResigner(createPunchResigner({ api, getSigner: async () => signer }));
    const item = await enqueue(original);
    startQueue(api);
    await settle();
    await flush();

    expect(punchNonce).toHaveBeenCalledTimes(1);
    expect(punchCreate).toHaveBeenCalledTimes(2);
    const [first, second] = punchCreate.mock.calls;
    expect(first?.[0].body.nonce).toBe('stale-offline-nonce');
    expect(second?.[0].body.nonce).toBe('fresh-nonce');
    expect(second?.[0].body.idempotencyKey).toBe(item.idempotencyKey);
    expect(getQueueSnapshot().items).toHaveLength(0);
  });
});
