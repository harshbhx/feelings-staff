import { fromBase64Url, PunchRequest, punchSigningPayload } from '@fs/contracts';
import { describe, expect, it } from 'vitest';
import { createMemoryPunchStore, type PunchSigner, type QueuedPunch } from './deps';
import {
  buildPunchRequest,
  offlineProof,
  type PunchFields,
  pinEnvelopePlaintext,
  punchProofMessage,
  sealPin,
  signPunchRequest,
  timeAnchorFrom,
} from './payload';

const KEY = '7b0c3c1e-6f0a-4f5e-9b1d-2a8c4d6e8f10';

function fields(over: Partial<PunchFields> = {}): PunchFields {
  return {
    kind: 'in',
    nonce: 'Hq7xT2mP9vR4tN8bCkZ3yL0sGwE5aD1u',
    deviceId: '01K80VYGQP1PYC7SQGE0Y8BQDX',
    idempotencyKey: KEY,
    fix: {
      lat: 22.4606479,
      lng: 70.0565093,
      accuracy: 18,
      samples: 3,
      spreadM: 2.5,
      accuracySpreadM: 6,
      altitudeNullAll: false,
      speedNullAll: false,
    },
    selfieSha256: null,
    qrToken: null,
    offsiteDutyId: null,
    placeName: null,
    note: null,
    requestApproval: false,
    ack: [],
    pin: '4827',
    offline: null,
    clientTs: 1792386720000,
    clientDurationMs: 4210.6,
    deviceTz: 'Asia/Kolkata',
    appVersion: '1.0.0',
    ...over,
  };
}

/** A signer that records what it signed. */
function recordingSigner(): PunchSigner & { messages: string[] } {
  const messages: string[] = [];
  return {
    deviceId: '01K80VYGQP1PYC7SQGE0Y8BQDX',
    messages,
    async sign(message: string) {
      messages.push(message);
      return `sig${messages.length}`;
    },
  };
}

async function rsaPair() {
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
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return { publicJwk, privateKey: pair.privateKey };
}

describe('buildPunchRequest (PRD 9.4)', () => {
  it('fills every PunchRequest field and passes the contract schema once signed', async () => {
    const req = await signPunchRequest(buildPunchRequest(fields()), recordingSigner());
    expect(PunchRequest.safeParse(req).success).toBe(true);
    expect(req.v).toBe(1);
    expect(req.clientDurationMs).toBe(4211);
  });

  it('trims and caps free text the way the server parses it, and drops empty text', () => {
    const req = buildPunchRequest(
      fields({ note: `  ${'a'.repeat(400)}  `, placeName: '  Patel wedding, Lal Bungalow ' }),
    );
    expect(req.note).toHaveLength(300);
    expect(req.placeName).toBe('Patel wedding, Lal Bungalow');
    expect(buildPunchRequest(fields({ note: '   ' })).note).toBeNull();
  });

  it('keeps each confirmation once', () => {
    expect(buildPunchRequest(fields({ ack: ['week_off', 'too_early', 'week_off'] })).ack).toEqual([
      'week_off',
      'too_early',
    ]);
  });
});

describe('signPunchRequest (PRD 10.3 punch signature)', () => {
  it('signs the canonical payload without signature, pin and offline.pinEnvelope', async () => {
    const signer = recordingSigner();
    const anchor = timeAnchorFrom(
      { serverTime: 1792386000000, timeSig: 'sig' },
      { perfNow: 100, dateNow: 1792386000000, pageSessionId: 'page-1' },
    );
    const offline = offlineProof(
      anchor,
      { perfNow: 5100, dateNow: 1792386005000, pageSessionId: 'page-1' },
      'ENVELOPE',
    );
    const req = await signPunchRequest(buildPunchRequest(fields({ pin: '4827', offline })), signer);
    const message = signer.messages[0] ?? '';
    expect(message).toBe(punchSigningPayload(req));
    expect(message).not.toContain('4827');
    expect(message).not.toContain('ENVELOPE');
    expect(message).not.toContain('"signature"');
    expect(message).toContain('"perfDeltaMs":5000');
    expect(req.signature).toBe('sig1');
  });

  it('S-04.3 a retry of the same tap keeps the idempotency key while the nonce changes', async () => {
    const signer = recordingSigner();
    const first = await signPunchRequest(buildPunchRequest(fields({ nonce: 'nonceA' })), signer);
    const retry = await signPunchRequest(buildPunchRequest(fields({ nonce: 'nonceB' })), signer);
    expect(retry.idempotencyKey).toBe(first.idempotencyKey);
    expect(signer.messages[0]).not.toBe(signer.messages[1]);
  });

  it('the door-code proof signs canonical { punchId, qrToken }', () => {
    expect(punchProofMessage('01K8K3XRWA6AA6YE5AQE7XZKJ7', 'ABCDEFGHJK')).toBe(
      '{"punchId":"01K8K3XRWA6AA6YE5AQE7XZKJ7","qrToken":"ABCDEFGHJK"}',
    );
  });
});

describe('offlineProof (PRD 4.3.6)', () => {
  const anchor = timeAnchorFrom(
    { serverTime: 1000, timeSig: 'ts' },
    { perfNow: 200, dateNow: 5000, pageSessionId: 'page-1' },
  );

  it('uses the performance clock only within the same page session', () => {
    const same = offlineProof(
      anchor,
      { perfNow: 1200, dateNow: 6500, pageSessionId: 'page-1' },
      'E',
    );
    expect(same).toEqual({
      lastServerTime: 1000,
      timeSig: 'ts',
      perfDeltaMs: 1000,
      wallDeltaMs: 1500,
      pinEnvelope: 'E',
    });
    const other = offlineProof(
      anchor,
      { perfNow: 50, dateNow: 9000, pageSessionId: 'page-2' },
      'E',
    );
    expect(other.perfDeltaMs).toBe(-1);
    expect(other.wallDeltaMs).toBe(4000);
  });
});

describe('sealPin (PRD 10.3 offline PIN envelope)', () => {
  it('round-trips through RSA-OAEP-256 with the server key', async () => {
    const { publicJwk, privateKey } = await rsaPair();
    const envelope = await sealPin(publicJwk, '4827', KEY);
    expect(envelope).toMatch(/^[A-Za-z0-9_-]+$/);
    const plain = await crypto.subtle.decrypt(
      { name: 'RSA-OAEP' },
      privateKey,
      fromBase64Url(envelope),
    );
    expect(new TextDecoder().decode(plain)).toBe(pinEnvelopePlaintext('4827', KEY));
    expect(JSON.parse(new TextDecoder().decode(plain))).toEqual({
      pin: '4827',
      idempotencyKey: KEY,
    });
  });

  it('S-09.4 the queued offline punch holds no plaintext PIN', async () => {
    const { publicJwk } = await rsaPair();
    const pin = '4827';
    const store = createMemoryPunchStore();
    await store.setTimeAnchor(
      timeAnchorFrom({ serverTime: 1000, timeSig: 'ts' }, { perfNow: 0, dateNow: 1000 }),
    );
    const anchor = await store.getTimeAnchor();
    if (!anchor) throw new Error('anchor missing');
    const offline = offlineProof(
      anchor,
      { perfNow: 10, dateNow: 2000 },
      await sealPin(publicJwk, pin, KEY),
    );
    const request = await signPunchRequest(
      buildPunchRequest(fields({ pin: null, offline, nonce: 'offlineNonce1' })),
      recordingSigner(),
    );
    const item: QueuedPunch = { idempotencyKey: KEY, request, selfie: null };
    expect(PunchRequest.safeParse(item.request).success).toBe(true);
    expect(item.request.pin).toBeNull();
    expect(JSON.stringify(item)).not.toContain(pin);
  });
});
