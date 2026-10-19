/**
 * Building and signing the punch payload (PRD 9.4, 10.3). Owner: WP-4.
 *
 * - `buildPunchRequest` fills every `PunchRequest` field (`v: 1`) and normalises free text the way
 *   the server's zod schema will (trimmed, length-capped), because the server checks the signature
 *   over what it parsed: a note with a trailing space would otherwise fail verification.
 * - `signPunchRequest` signs `punchSigningPayload(request)` (RFC 8785 canonical JSON without
 *   `signature`, `pin` and `offline.pinEnvelope`) with the device key.
 * - `sealPin` is the offline PIN envelope: RSA-OAEP-256 over the UTF-8 JSON
 *   `{"pin":"1234","idempotencyKey":"..."}` with `PublicConfig.punchEncPublicJwk`, base64url. Only
 *   the server can open it; the plain PIN is never stored (S-09.4).
 * - `offlineProof` is the `offline` block: the last signed server time and the clock deltas since.
 */
import {
  canonicalJson,
  type Fix,
  type OfflineProof,
  type PunchKind,
  type PunchRequest,
  punchSigningPayload,
  toBase64Url,
} from '@fs/contracts';
import type { PunchSigner, TimeAnchor } from './deps';

export type PunchAck = PunchRequest['ack'][number];
export type UnsignedPunchRequest = Omit<PunchRequest, 'signature'>;

/** A random id for this page load: `perfNow` anchors are only comparable within it. */
export const PAGE_SESSION_ID: string =
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export const NOTE_MAX = 300;
export const PLACE_NAME_MAX = 120;

/** Trim and cap free text; empty becomes null. */
export function cleanText(input: string | null | undefined, max: number): string | null {
  if (input === null || input === undefined) return null;
  const s = input.trim().slice(0, max).trim();
  return s.length > 0 ? s : null;
}

/** The device's IANA time zone (risk signal when not Asia/Kolkata). */
export function deviceTimeZone(): string {
  try {
    return (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC').slice(0, 64);
  } catch {
    return 'UTC';
  }
}

export interface PunchFields {
  kind: PunchKind;
  nonce: string;
  deviceId: string;
  /** One per tap; reused for every retry of that tap. */
  idempotencyKey: string;
  fix: Fix | null;
  selfieSha256: string | null;
  qrToken: string | null;
  offsiteDutyId: string | null;
  placeName: string | null;
  note: string | null;
  requestApproval: boolean;
  ack: readonly PunchAck[];
  /** Online only; offline punches carry the PIN sealed in `offline.pinEnvelope`. */
  pin: string | null;
  offline: OfflineProof | null;
  /** Date.now() at submit. */
  clientTs: number;
  /** Milliseconds from the tap to the submit. */
  clientDurationMs: number;
  deviceTz: string;
  appVersion: string;
}

/** Every field of a `PunchRequest` except the signature. */
export function buildPunchRequest(f: PunchFields): UnsignedPunchRequest {
  const ack: PunchAck[] = [];
  for (const a of f.ack) if (!ack.includes(a)) ack.push(a);
  return {
    v: 1,
    kind: f.kind,
    nonce: f.nonce,
    deviceId: f.deviceId,
    clientTs: Math.round(f.clientTs),
    idempotencyKey: f.idempotencyKey,
    fix: f.fix,
    selfieSha256: f.selfieSha256,
    qrToken: f.qrToken,
    offsiteDutyId: f.offsiteDutyId,
    placeName: cleanText(f.placeName, PLACE_NAME_MAX),
    deviceTz: f.deviceTz.slice(0, 64),
    offline: f.offline,
    pin: f.pin,
    clientDurationMs: Math.max(0, Math.round(f.clientDurationMs)),
    requestApproval: f.requestApproval,
    note: cleanText(f.note, NOTE_MAX),
    ack,
    appVersion: f.appVersion.slice(0, 32),
  };
}

/** The exact string the device key signs. */
export function punchSigningMessage(req: UnsignedPunchRequest | PunchRequest): string {
  return punchSigningPayload(req);
}

export async function signPunchRequest(
  req: UnsignedPunchRequest,
  signer: PunchSigner,
): Promise<PunchRequest> {
  const signature = await signer.sign(punchSigningMessage(req));
  return { ...req, signature };
}

/** What the device key signs to attach a door code to a pending punch (PRD 9.4 `punchProof`). */
export function punchProofMessage(punchId: string, qrToken: string): string {
  return canonicalJson({ punchId, qrToken });
}

/** The plaintext inside the offline PIN envelope, exactly `{"pin":...,"idempotencyKey":...}`. */
export function pinEnvelopePlaintext(pin: string | null, idempotencyKey: string): string {
  return JSON.stringify({ pin, idempotencyKey });
}

/** Seal the PIN for an offline punch (RSA-OAEP with SHA-256), base64url. */
export async function sealPin(
  publicJwk: JsonWebKey,
  pin: string | null,
  idempotencyKey: string,
): Promise<string> {
  const jwk: JsonWebKey = { kty: 'RSA', alg: 'RSA-OAEP-256', ext: true, key_ops: ['encrypt'] };
  if (publicJwk.n) jwk.n = publicJwk.n;
  if (publicJwk.e) jwk.e = publicJwk.e;
  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt'],
  );
  const plain = new TextEncoder().encode(pinEnvelopePlaintext(pin, idempotencyKey));
  const sealed = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, key, plain);
  return toBase64Url(sealed);
}

/** A time anchor from a signed server time that just arrived. */
export function timeAnchorFrom(
  signed: { serverTime: number; timeSig: string },
  clocks: { perfNow: number; dateNow: number; pageSessionId?: string },
): TimeAnchor {
  return {
    serverTime: signed.serverTime,
    timeSig: signed.timeSig,
    perfNow: clocks.perfNow,
    dateNow: clocks.dateNow,
    pageSessionId: clocks.pageSessionId ?? PAGE_SESSION_ID,
  };
}

/**
 * The `offline` block (PRD 4.3.6): `perfDeltaMs` = performance.now() - anchor.perfNow when the
 * anchor is from this page session, else -1; `wallDeltaMs` = Date.now() - anchor.dateNow.
 */
export function offlineProof(
  anchor: TimeAnchor,
  clocks: { perfNow: number; dateNow: number; pageSessionId?: string },
  pinEnvelope: string,
): OfflineProof {
  const session = clocks.pageSessionId ?? PAGE_SESSION_ID;
  return {
    lastServerTime: anchor.serverTime,
    timeSig: anchor.timeSig,
    perfDeltaMs:
      anchor.pageSessionId === session
        ? Math.max(0, Math.round(clocks.perfNow - anchor.perfNow))
        : -1,
    wallDeltaMs: Math.round(clocks.dateNow - anchor.dateNow),
    pinEnvelope,
  };
}
