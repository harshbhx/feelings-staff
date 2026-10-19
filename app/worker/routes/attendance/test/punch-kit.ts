/**
 * Test kit for the punch pipeline (WP-4): a salon with one approved staff phone, signed multipart
 * punches, nonces and offline envelopes. Test-only module (this path may use raw D1).
 */
import {
  type Fix,
  fromBase64Url,
  type PunchRequest,
  type PunchResult,
  punchSigningPayload,
  toBase64Url,
} from '@fs/contracts';
import { callJson, sessionFor, testEnv } from '../../../test/helpers';
import { ist, newSalon, type Salon } from '../../../test/notify-kit';
import {
  approve,
  createStaff,
  type DeviceKey,
  joinStaff,
  setClock,
  signText,
} from '../../auth/test/kit';

export const SALON = { lat: 22.4606479, lng: 70.0565093 };

/** A clean, accepted-quality fix at the salon counter; `dLat` moves it north in degrees. */
export function fixAt(dLat = 0, over: Partial<Fix> = {}): Fix {
  return {
    lat: SALON.lat + dLat,
    lng: SALON.lng,
    accuracy: 18,
    samples: 4,
    spreadM: 2.5,
    accuracySpreadM: 6,
    altitudeNullAll: false,
    speedNullAll: false,
    ...over,
  };
}

export interface Phone {
  id: string;
  phone: string;
  pin: string;
  cookie: string;
  deviceId: string;
  key: DeviceKey;
}

export interface Harness {
  salon: Salon;
  owner: string;
  phone: Phone;
  /** The fake server clock, as last set. */
  clock: number;
  /** Set the fake server clock. */
  at(ts: number): Promise<void>;
}

let seq = 0;

/** Create, join and approve one staff phone; its approval is 30 days old so it adds no risk. */
export async function addPhone(
  salon: Salon,
  owner: string,
  over: Record<string, unknown> = {},
): Promise<Phone> {
  const staff = await createStaff(owner, over);
  const joined = await joinStaff(staff);
  const deviceId = joined.me.device?.id as string;
  const res = await approve(owner, deviceId);
  if (res.status !== 200) throw new Error(`approve ${res.status}`);
  await testEnv.DB.prepare('UPDATE devices SET approved_at = ?2 WHERE id = ?1')
    .bind(deviceId, Date.UTC(2026, 8, 1))
    .run();
  void salon;
  return {
    id: staff.id,
    phone: staff.phone,
    pin: joined.pin,
    cookie: joined.cookie,
    deviceId,
    key: joined.key,
  };
}

export async function harness(over: Record<string, unknown> = {}): Promise<Harness> {
  const salon = await newSalon();
  const owner = await sessionFor(salon.ownerId, { stepUp: true });
  await setClock(ist('10:05'));
  const phone = await addPhone(salon, owner, over);
  const h: Harness = {
    salon,
    owner,
    phone,
    clock: ist('10:05'),
    async at(ts) {
      h.clock = ts;
      await setClock(ts);
    },
  };
  return h;
}

export async function nonce(
  cookie: string,
): Promise<{ nonce: string; serverTime: number; timeSig: string }> {
  const res = await callJson<{ nonce: string; serverTime: number; timeSig: string }>(
    'POST',
    '/punch/nonce',
    { cookie, body: { purpose: 'punch' } },
  );
  if (res.status !== 200) throw new Error(`nonce ${res.status}`);
  return res.body;
}

export async function offlineNonces(cookie: string) {
  const res = await callJson<{
    nonces: { nonce: string; expiresAt: number }[];
    serverTime: number;
    timeSig: string;
  }>('POST', '/punch/nonce', { cookie, body: { purpose: 'offline' } });
  if (res.status !== 200) throw new Error(`offline nonce ${res.status}`);
  return res.body;
}

export interface PunchOpts {
  nonce?: string;
  selfie?: Uint8Array | null;
  key?: DeviceKey;
  cookie?: string;
  /** Skip signing (to test the signature check). */
  badSignature?: boolean;
}

export function uuid(): string {
  seq += 1;
  return `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
}

/** Sign and send POST /punches as multipart, like the app does. */
export async function punch<T = PunchResult>(
  h: Harness,
  over: Partial<PunchRequest> = {},
  opts: PunchOpts = {},
): Promise<{ status: number; body: T }> {
  const cookie = opts.cookie ?? h.phone.cookie;
  const n = opts.nonce ?? (await nonce(cookie)).nonce;
  const base = {
    v: 1,
    kind: 'in',
    nonce: n,
    deviceId: h.phone.deviceId,
    clientTs: h.clock,
    idempotencyKey: uuid(),
    fix: fixAt(),
    selfieSha256: null,
    qrToken: null,
    offsiteDutyId: null,
    placeName: null,
    deviceTz: 'Asia/Kolkata',
    offline: null,
    pin: h.phone.pin,
    clientDurationMs: 3000,
    requestApproval: false,
    note: null,
    ack: [],
    appVersion: '1.0.0',
    ...over,
  } as Omit<PunchRequest, 'signature'>;
  const signature = opts.badSignature
    ? 'AAAA'
    : await signText(opts.key ?? h.phone.key, punchSigningPayload(base as PunchRequest));
  const form = new FormData();
  form.set('payload', JSON.stringify({ ...base, signature }));
  if (opts.selfie)
    form.set('selfie', new Blob([opts.selfie], { type: 'image/jpeg' }), 'selfie.jpg');
  return callJson<T>('POST', '/punches', {
    cookie,
    raw: form,
    headers: { 'Idempotency-Key': base.idempotencyKey },
  });
}

/** A fake JPEG body and its SHA-256, for selfie tests. */
export async function jpeg(size = 4000): Promise<{ bytes: Uint8Array<ArrayBuffer>; sha: string }> {
  const bytes = new Uint8Array(size).fill(0x42);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return { bytes, sha: [...digest].map((b) => b.toString(16).padStart(2, '0')).join('') };
}

/** RSA-OAEP seal of the PIN, like the app does for offline punches. */
export async function sealPin(
  publicJwk: Record<string, unknown>,
  pin: string,
  idempotencyKey: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'jwk',
    {
      kty: 'RSA',
      alg: 'RSA-OAEP-256',
      ext: true,
      key_ops: ['encrypt'],
      n: publicJwk.n,
      e: publicJwk.e,
    } as JsonWebKey,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt'],
  );
  const sealed = await crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    key,
    new TextEncoder().encode(JSON.stringify({ pin, idempotencyKey })),
  );
  return toBase64Url(sealed);
}

export const b64 = { toBase64Url, fromBase64Url };

export async function rows<T>(sql: string, ...args: (string | number)[]): Promise<T[]> {
  return (
    await testEnv.DB.prepare(sql)
      .bind(...args)
      .all<T>()
  ).results;
}
