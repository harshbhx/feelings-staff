/**
 * WP-3 test kit for Workers API tests: real ECDSA P-256 device keys (WebCrypto), staff creation,
 * join, sign-in and the fake clock. Test-only module (the /test/ path allows raw D1 access).
 */
import type { InviteView, Me, StaffCreated } from '@fs/contracts';
import { toBase64Url } from '@fs/contracts';
import { call, callJson, e2eHeaders, sessionFor, testEnv } from '../../../test/helpers';

export interface DeviceKey {
  privateKey: CryptoKey;
  jwk: { kty: 'EC'; crv: 'P-256'; x: string; y: string };
}

/** A phone key like the app makes: non-extractable private key, public JWK. */
export async function makeDeviceKey(): Promise<DeviceKey> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const pub = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey;
  return {
    privateKey: pair.privateKey,
    jwk: { kty: 'EC', crv: 'P-256', x: pub.x ?? '', y: pub.y ?? '' },
  };
}

export async function signText(key: DeviceKey, text: string): Promise<string> {
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key.privateKey,
    new TextEncoder().encode(text),
  );
  return toBase64Url(sig);
}

export function cookieFrom(res: Response): string | null {
  const all =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : [res.headers.get('Set-Cookie') ?? ''];
  for (const line of all) {
    const m = line.match(/fs_session=([^;]+)/);
    if (m?.[1]) return m[1];
  }
  return null;
}

export async function errorCode(
  res: Response,
): Promise<{ code: string; details?: Record<string, unknown>; message: string }> {
  const body = (await res.json()) as {
    error: { code: string; details?: Record<string, unknown>; message: string };
  };
  return body.error;
}

export async function setClock(nowMs: number | null): Promise<void> {
  const res = await call('POST', '/__test/clock', { body: { nowMs }, headers: e2eHeaders() });
  if (res.status !== 200) throw new Error(`clock ${res.status}`);
}

export async function templateId(name = 'Full day'): Promise<string> {
  const row = await testEnv.DB.prepare('SELECT id FROM shift_templates WHERE name = ?1 LIMIT 1')
    .bind(name)
    .first<{ id: string }>();
  if (!row) throw new Error('no template');
  return row.id;
}

let phoneSeq = 0;
/** A fresh valid Indian mobile number for each call. */
export function nextPhone(): string {
  phoneSeq += 1;
  return `+9198250${String(10000 + phoneSeq).slice(-5)}`;
}

export interface CreatedStaff {
  id: string;
  phone: string;
  invite: InviteView;
  rawCode: string;
}

export async function createStaff(
  ownerCookie: string,
  over: Record<string, unknown> = {},
): Promise<CreatedStaff> {
  const phone = (over.phone as string | undefined) ?? nextPhone();
  const { status, body } = await callJson<StaffCreated>('POST', '/owner/staff', {
    cookie: ownerCookie,
    body: {
      name: 'Priya Solanki',
      phone,
      designation: 'Stylist',
      joinDate: '2026-10-01',
      salaryType: 'monthly',
      salaryAmountPaise: 1500000,
      defaultTemplateId: await templateId(),
      weekOffDow: 2,
      lang: 'en',
      selfieRequired: null,
      adultConfirmed: true,
      ...over,
    },
  });
  if (status !== 201) throw new Error(`create staff ${status} ${JSON.stringify(body)}`);
  const rawCode = body.invite.url.split('/').pop() ?? '';
  return { id: body.staff.id, phone, invite: body.invite, rawCode };
}

export const NOTICE_VERSION = '2026-10-19';

export function joinBody(opts: {
  phone: string;
  code: string;
  pin?: string;
  key: DeviceKey;
  extra?: Record<string, unknown>;
}) {
  return {
    phone: opts.phone,
    code: opts.code,
    pin: opts.pin ?? '2580',
    deviceJwk: opts.key.jwk,
    deviceLabel: 'Redmi Note 12 · Chrome',
    platform: 'android',
    consents: [{ kind: 'privacy_notice', version: NOTICE_VERSION, lang: 'en' }],
    storagePersisted: true,
    ...(opts.extra ?? {}),
  };
}

export interface Joined {
  cookie: string;
  me: Me;
  key: DeviceKey;
  pin: string;
}

export async function joinStaff(
  staff: CreatedStaff,
  pin = '2580',
  key?: DeviceKey,
): Promise<Joined> {
  const k = key ?? (await makeDeviceKey());
  const res = await call('POST', '/join/complete', {
    body: joinBody({ phone: staff.phone, code: staff.rawCode, pin, key: k }),
  });
  if (res.status !== 200) throw new Error(`join ${res.status} ${await res.text()}`);
  const cookie = cookieFrom(res);
  if (!cookie) throw new Error('no cookie');
  return { cookie, me: (await res.json()) as Me, key: k, pin };
}

/** An owner session with step-up done (test shortcut). */
export function ownerStepUp(ownerId: string): Promise<string> {
  return sessionFor(ownerId, { stepUp: true });
}

export async function approve(ownerCookie: string, deviceId: string): Promise<Response> {
  return call('POST', `/owner/devices/${deviceId}/decide`, {
    cookie: ownerCookie,
    body: { decision: 'approve' },
  });
}

/** Challenge + signature + PIN sign-in. */
export async function staffLogin(opts: {
  phone: string;
  pin: string;
  deviceId: string;
  key: DeviceKey;
  nonce?: string;
  signature?: string;
}): Promise<Response> {
  let nonce = opts.nonce;
  if (!nonce) {
    const ch = await callJson<{ nonce: string }>('GET', '/auth/challenge?purpose=login');
    nonce = ch.body.nonce;
  }
  return call('POST', '/auth/staff/login', {
    body: {
      phone: opts.phone,
      pin: opts.pin,
      deviceId: opts.deviceId,
      nonce,
      signature: opts.signature ?? (await signText(opts.key, nonce)),
    },
  });
}

export async function auditActions(entityId: string): Promise<string[]> {
  const rows = await testEnv.DB.prepare(
    'SELECT action FROM audit_log WHERE entity_id = ?1 ORDER BY created_at, id',
  )
    .bind(entityId)
    .all<{ action: string }>();
  return rows.results.map((r) => r.action);
}
