import { ApiError, type PunchRequest, type PunchResult } from '@fs/contracts';
import { describe, expect, it, vi } from 'vitest';
import { createMemoryPunchStore, type QueuedPunch } from './deps';
import { initialPunchState, type PunchFlowState } from './state';
import { runSubmission, type SubmitDeps } from './submit';

const KEY = '7b0c3c1e-6f0a-4f5e-9b1d-2a8c4d6e8f10';
const FIX = {
  lat: 22.46,
  lng: 70.05,
  accuracy: 12,
  samples: 3,
  spreadM: 1,
  accuracySpreadM: 2,
  altitudeNullAll: false,
  speedNullAll: false,
};
const PUNCH = {
  punch: { id: 'p1' },
  outcome: 'accepted',
  proofUntil: null,
} as unknown as PunchResult;

function state(over: Partial<PunchFlowState> = {}): PunchFlowState {
  return {
    ...initialPunchState,
    step: 'signing',
    kind: 'in',
    needs: { location: true, selfie: false, pin: true },
    tapAt: 1000,
    idempotencyKey: KEY,
    location: { ...initialPunchState.location, status: 'done', fix: FIX, fixAt: 1000 },
    pinReady: true,
    submission: { type: 'punch' },
    attempt: 1,
    ...over,
  };
}

function setup(over: Partial<SubmitDeps['api']> = {}, online = true) {
  const queued: QueuedPunch[] = [];
  const sent: PunchRequest[] = [];
  const headers: (string | undefined)[] = [];
  let n = 0;
  const api = {
    punchNonce: vi.fn(async (input: { body: { purpose: string } }) =>
      input.body.purpose === 'offline'
        ? { nonces: [], serverTime: 1, timeSig: 's' }
        : { nonce: `nonce-${++n}`, expiresAt: 9, serverTime: 5000, timeSig: 'ts' },
    ),
    punchCreate: vi.fn(async (input: { body: PunchRequest }, o?: { idempotencyKey?: string }) => {
      sent.push(input.body);
      headers.push(o?.idempotencyKey);
      return PUNCH;
    }),
    punchProof: vi.fn(async () => PUNCH),
    punchRequestApproval: vi.fn(async () => PUNCH),
    config: vi.fn(async () => ({ punchEncPublicJwk: {} })),
    time: vi.fn(async () => ({ serverTime: 1, timeSig: 's' })),
    ...over,
  } as unknown as SubmitDeps['api'];
  const deps: SubmitDeps = {
    api,
    getSigner: async () => ({ deviceId: 'dev1', sign: async () => 'sig' }),
    queue: {
      async enqueue(i) {
        queued.push(i);
      },
    },
    store: createMemoryPunchStore(),
    appVersion: '1.0.0',
    isOnline: () => online,
    now: () => 2000,
    perfNow: () => 50,
  };
  return { deps, sent, headers, queued, api };
}

describe('runSubmission', () => {
  it('S-04.3 sends the idempotency key in the body and the header', async () => {
    const t = setup();
    const ev = await runSubmission(t.deps, { state: state(), pin: '4827', offsiteDutyId: null });
    expect(ev.type).toBe('SUBMIT_OK');
    expect(t.sent[0]?.idempotencyKey).toBe(KEY);
    expect(t.headers[0]).toBe(KEY);
    expect(t.sent[0]?.pin).toBe('4827');
  });

  it('asks for the PIN again when it is not in memory', async () => {
    const t = setup();
    const ev = await runSubmission(t.deps, { state: state(), pin: null, offsiteDutyId: null });
    expect(ev.type).toBe('PIN_NEEDED');
  });

  it('S-04.4 a rejected nonce is replaced once, silently, with the same idempotency key', async () => {
    let calls = 0;
    const t = setup({
      punchCreate: vi.fn(async (input: { body: PunchRequest }) => {
        if (++calls === 1) throw new ApiError({ code: 'NONCE_INVALID', status: 409 });
        return { ...PUNCH, echo: input.body.nonce };
      }) as never,
    });
    const ev = await runSubmission(t.deps, { state: state(), pin: '4827', offsiteDutyId: null });
    expect(ev.type).toBe('SUBMIT_OK');
    expect(t.api.punchNonce).toHaveBeenCalledTimes(2);
  });

  it('gives up after a second rejected nonce', async () => {
    const t = setup({
      punchCreate: vi.fn(async () => {
        throw new ApiError({ code: 'NONCE_INVALID', status: 409 });
      }) as never,
    });
    const ev = await runSubmission(t.deps, { state: state(), pin: '4827', offsiteDutyId: null });
    expect(ev).toMatchObject({
      type: 'SUBMIT_FAILED',
      result: { kind: 'failed', reason: 'nonce' },
    });
  });

  it('S-05.3 a wrong PIN becomes the pin_wrong result with tries left', async () => {
    const t = setup({
      punchCreate: vi.fn(async () => {
        throw new ApiError({ code: 'PIN_WRONG', status: 401, details: { triesLeft: 3 } });
      }) as never,
    });
    const ev = await runSubmission(t.deps, { state: state(), pin: '0000', offsiteDutyId: null });
    expect(ev).toMatchObject({ result: { kind: 'pin_wrong', triesLeft: 3 } });
  });

  it('S-09.1 offline: queues a signed request with an offline nonce and no plaintext PIN (S-09.4)', async () => {
    const pair = (await crypto.subtle.generateKey(
      {
        name: 'RSA-OAEP',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['encrypt', 'decrypt'],
    )) as CryptoKeyPair;
    const t = setup({}, false);
    await t.deps.store.setPunchKey(await crypto.subtle.exportKey('jwk', pair.publicKey));
    await t.deps.store.setTimeAnchor({
      serverTime: 1000,
      timeSig: 'ts',
      perfNow: 10,
      dateNow: 1000,
      pageSessionId: 'x',
    });
    await t.deps.store.putOfflineNonces([{ nonce: 'off-1', expiresAt: 1e13 }]);
    const ev = await runSubmission(t.deps, { state: state(), pin: '4827', offsiteDutyId: null });
    expect(ev.type).toBe('QUEUED');
    const item = t.queued[0];
    expect(item?.request.nonce).toBe('off-1');
    expect(item?.request.pin).toBeNull();
    expect(item?.request.offline?.perfDeltaMs).toBe(-1);
    expect(JSON.stringify(item?.request)).not.toContain('4827');
    expect(t.api.punchCreate).not.toHaveBeenCalled();
  });

  it('S-09.2 a network failure falls back to the offline queue', async () => {
    const t = setup({
      punchNonce: vi.fn(async () => {
        throw new ApiError({ code: 'UNAVAILABLE', status: 0 });
      }) as never,
    });
    const ev = await runSubmission(t.deps, { state: state(), pin: '4827', offsiteDutyId: null });
    expect(ev).toMatchObject({ result: { kind: 'failed', reason: 'offline_unavailable' } });
  });

  it('S-06.4 attaches a door code to a pending punch with a signature over the proof', async () => {
    const t = setup();
    const ev = await runSubmission(t.deps, {
      state: state({ submission: { type: 'proof', punchId: 'p1', qrToken: 'ABCDEFGHJK' } }),
      pin: null,
      offsiteDutyId: null,
    });
    expect(ev.type).toBe('SUBMIT_OK');
    expect(t.api.punchProof).toHaveBeenCalledWith({
      params: { id: 'p1' },
      body: { qrToken: 'ABCDEFGHJK', signature: 'sig' },
    });
  });

  it('reports a missing device key', async () => {
    const t = setup();
    t.deps.getSigner = async () => {
      throw new Error('no key');
    };
    const ev = await runSubmission(t.deps, { state: state(), pin: '4827', offsiteDutyId: null });
    expect(ev).toMatchObject({ result: { kind: 'failed', reason: 'device_key' } });
  });
});
