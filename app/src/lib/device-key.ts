/**
 * Device key (PRD 4.1.4, 10.3, 11.5). Owner: WP-3.
 *
 * Each phone holds one ECDSA P-256 key pair generated with `extractable: false`; the private
 * CryptoKey lives only in IndexedDB (`device` store) and never leaves the browser. The server keeps
 * the public JWK and its RFC 7638 thumbprint, and checks signatures over login challenges and
 * punches. WP-4 signs punches with `sign()`.
 */
import { type Platform, toBase64Url } from '@fs/contracts';
import { type DeviceRecord, indexedDbAvailable, openFeelingsDb } from './idb';

const ECDSA_KEY: EcKeyGenParams = { name: 'ECDSA', namedCurve: 'P-256' };
const ECDSA_SIGN: EcdsaParams = { name: 'ECDSA', hash: 'SHA-256' };
const LABEL_MAX = 80;

export type DeviceKeyProblem = 'webcrypto' | 'indexeddb' | 'missing';

export class DeviceKeyError extends Error {
  constructor(readonly problem: DeviceKeyProblem) {
    super(`Device key unavailable: ${problem}`);
    this.name = 'DeviceKeyError';
  }
}

export type DeviceKeySupport = { ok: true } | { ok: false; reason: 'webcrypto' | 'indexeddb' };

function webCryptoAvailable(): boolean {
  try {
    return (
      typeof crypto !== 'undefined' &&
      typeof crypto.subtle?.generateKey === 'function' &&
      typeof crypto.subtle?.sign === 'function'
    );
  } catch {
    return false;
  }
}

/**
 * Can this browser keep a device key? False on old browsers and private modes without IndexedDB
 * (the join flow then stops with the "can't keep the app's security key" message).
 */
export async function checkDeviceKeySupport(): Promise<DeviceKeySupport> {
  if (!webCryptoAvailable()) return { ok: false, reason: 'webcrypto' };
  if (!indexedDbAvailable()) return { ok: false, reason: 'indexeddb' };
  try {
    await openFeelingsDb();
  } catch {
    return { ok: false, reason: 'indexeddb' };
  }
  return { ok: true };
}

/** The stored device record, or null when this browser has no key yet. */
export async function getDeviceRecord(): Promise<DeviceRecord | null> {
  if (!indexedDbAvailable()) return null;
  try {
    const db = await openFeelingsDb();
    return (await db.get('device', 'current')) ?? null;
  } catch {
    return null;
  }
}

/**
 * Generate a fresh non-extractable key pair and store it, replacing any old one. Every join and
 * "I have a new phone" request uses a fresh key (a rejected key can never be approved later).
 */
export async function createDeviceKey(now = Date.now()): Promise<DeviceRecord> {
  if (!webCryptoAvailable()) throw new DeviceKeyError('webcrypto');
  const pair = (await crypto.subtle.generateKey(ECDSA_KEY, false, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  // Only the public half is exportable; the private key stays extractable: false.
  const full = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const publicJwk: JsonWebKey = {
    kty: full.kty ?? 'EC',
    crv: full.crv ?? 'P-256',
    x: full.x ?? '',
    y: full.y ?? '',
  };
  const record: DeviceRecord = {
    deviceId: null,
    privateKey: pair.privateKey,
    publicJwk,
    approved: false,
    createdAt: now,
  };
  try {
    const db = await openFeelingsDb();
    await db.put('device', record, 'current');
  } catch {
    throw new DeviceKeyError('indexeddb');
  }
  return record;
}

/** Remember the server's id and approval state for the stored key. */
export async function setDeviceServerState(deviceId: string, approved: boolean): Promise<void> {
  const db = await openFeelingsDb();
  const rec = await db.get('device', 'current');
  if (!rec) throw new DeviceKeyError('missing');
  await db.put('device', { ...rec, deviceId, approved }, 'current');
}

/** Forget the key (after the owner rejects or removes this phone). */
export async function clearDeviceKey(): Promise<void> {
  try {
    const db = await openFeelingsDb();
    await db.delete('device', 'current');
  } catch {
    // nothing stored
  }
}

/** ECDSA P-256/SHA-256 over the UTF-8 message; base64url of the IEEE P1363 (r || s) signature. */
export async function signWithKey(privateKey: CryptoKey, message: string): Promise<string> {
  const sig = await crypto.subtle.sign(ECDSA_SIGN, privateKey, new TextEncoder().encode(message));
  return toBase64Url(sig);
}

/** Sign with this phone's stored key (login challenge nonce, punch canonical JSON). */
export async function sign(message: string): Promise<string> {
  const rec = await getDeviceRecord();
  if (!rec) throw new DeviceKeyError('missing');
  return signWithKey(rec.privateKey, message);
}

/**
 * Ask the browser not to evict our storage (PRD 11.8). Returns the result; a refusal only shows the
 * "keep this app installed" tip later.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

// ---- Platform and label ------------------------------------------------------------------------

/** android / ios / desktop / other, from the user agent (iPadOS reports a Mac UA with touch). */
export function detectPlatform(ua: string, maxTouchPoints = 0): Platform {
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Macintosh/i.test(ua) && maxTouchPoints > 1) return 'ios';
  if (/Windows NT|Macintosh|CrOS|X11|Linux x86_64/i.test(ua)) return 'desktop';
  return 'other';
}

/** Browser name for the label, including in-app browsers. */
export function browserName(ua: string): string {
  if (/WhatsApp/i.test(ua)) return 'WhatsApp';
  if (/Instagram/i.test(ua)) return 'Instagram';
  if (/FBAN|FBAV|FB_IAB/i.test(ua)) return 'Facebook';
  if (/SamsungBrowser/i.test(ua)) return 'Samsung Internet';
  if (/EdgA|EdgiOS|Edg\//i.test(ua)) return 'Edge';
  if (/OPR\/|OPiOS|Opera/i.test(ua)) return 'Opera';
  if (/FxiOS|Firefox\//i.test(ua)) return 'Firefox';
  if (/CriOS|Chrome\//i.test(ua)) return 'Chrome';
  if (/Safari\//i.test(ua)) return 'Safari';
  return 'Browser';
}

/** Phone model from an Android UA ("Redmi Note 12"); null when the UA hides it (reduced UA "K"). */
export function androidModel(ua: string): string | null {
  const inside = ua.match(/\(([^)]*)\)/)?.[1] ?? '';
  const parts = inside.split(';').map((p) => p.trim());
  const at = parts.findIndex((p) => /^Android\b/i.test(p));
  if (at < 0) return null;
  for (const p of parts.slice(at + 1)) {
    const v = p.replace(/\s*Build\/.*$/i, '').trim();
    if (!v || v === 'K' || v === 'wv' || /^[a-z]{2}[-_][a-z]{2}$/i.test(v)) continue;
    return v;
  }
  return null;
}

function modelFor(ua: string, platform: Platform, hint: string | null): string {
  if (hint?.trim()) return hint.trim();
  if (platform === 'android') return androidModel(ua) ?? 'Android phone';
  if (platform === 'ios') return /iPad/.test(ua) || /Macintosh/.test(ua) ? 'iPad' : 'iPhone';
  if (/CrOS/.test(ua)) return 'Chromebook';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Linux/.test(ua)) return 'Linux';
  return 'Phone';
}

/** "Redmi Note 12 · Chrome" from a user agent (and the Client Hints model when known). */
export function deviceLabelFromUa(
  ua: string,
  opts: { maxTouchPoints?: number; model?: string | null } = {},
): string {
  const platform = detectPlatform(ua, opts.maxTouchPoints ?? 0);
  const label = `${modelFor(ua, platform, opts.model ?? null)} · ${browserName(ua)}`;
  return label.length > LABEL_MAX ? label.slice(0, LABEL_MAX) : label;
}

interface UaData {
  getHighEntropyValues?(hints: string[]): Promise<{ model?: string }>;
}

/** This phone's label. Chrome on Android hides the model in the UA; Client Hints still give it. */
export async function deviceLabel(): Promise<string> {
  const nav = navigator as Navigator & { userAgentData?: UaData };
  let model: string | null = null;
  try {
    model = (await nav.userAgentData?.getHighEntropyValues?.(['model']))?.model ?? null;
  } catch {
    model = null;
  }
  return deviceLabelFromUa(nav.userAgent, { maxTouchPoints: nav.maxTouchPoints ?? 0, model });
}

/** This browser's platform. */
export function currentPlatform(): Platform {
  return detectPlatform(navigator.userAgent, navigator.maxTouchPoints ?? 0);
}
