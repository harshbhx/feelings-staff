/**
 * WebCrypto helpers shared by every package (PRD 10.3). Owner: WP-1.
 * All secrets come from Env; nothing here logs inputs or outputs.
 */
import { fromBase64Url, toBase64Url } from '@fs/contracts';

const enc = new TextEncoder();

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

/** 32 random bytes as base64url (session tokens, nonces, verify tokens use smaller n). */
export function randomToken(bytes = 32): string {
  return toBase64Url(randomBytes(bytes));
}

/** Random code from the Crockford alphabet (join, pairing codes). */
export function randomCode(length = 8): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const bytes = randomBytes(length);
  let s = '';
  for (const b of bytes) s += alphabet[b % 32];
  return s;
}

/** Random numeric code, e.g. the 6-digit magic code. */
export function randomDigits(length = 6): string {
  const bytes = randomBytes(length);
  let s = '';
  for (const b of bytes) s += String(b % 10);
  return s;
}

export async function sha256(
  data: string | Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const buf = typeof data === 'string' ? enc.encode(data) : data;
  return new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
}

export async function sha256Hex(data: string | Uint8Array<ArrayBuffer>): Promise<string> {
  return [...(await sha256(data))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const hmacKeys = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
  let k = hmacKeys.get(secret);
  if (!k) {
    k = crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    hmacKeys.set(secret, k);
  }
  return k;
}

/** HMAC-SHA256(secret, message) as base64url. */
export async function hmac(
  secret: string,
  message: string | Uint8Array<ArrayBuffer>,
): Promise<string> {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    typeof message === 'string' ? enc.encode(message) : message,
  );
  return toBase64Url(sig);
}

/** Constant-time string comparison. */
export function timingSafeEqual(a: string, b: string): boolean {
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  const n = Math.max(ab.length, bb.length);
  for (let i = 0; i < n; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

/** Codes (join, magic, pairing) are stored as HMAC(SESSION_SECRET, code) (PRD 10.3). */
export function hashCode(sessionSecret: string, code: string): Promise<string> {
  return hmac(sessionSecret, `code:${code}`);
}

/** PIN hash: HMAC-SHA256(PIN_PEPPER, salt || pin) (PRD 10.3). `salt` is base64url of 16 bytes. */
export function hashPin(pepper: string, salt: string, pin: string): Promise<string> {
  return hmac(pepper, `${salt}:${pin}`);
}

export const PASSWORD_ITERATIONS = 100_000;

/** Owner password: PBKDF2-SHA256 (100k), then HMAC with PIN_PEPPER (PRD 10.3). */
export async function hashPassword(
  pepper: string,
  salt: string,
  password: string,
  iterations = PASSWORD_ITERATIONS,
): Promise<string> {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64Url(salt), iterations },
    base,
    256,
  );
  return hmac(pepper, new Uint8Array(bits));
}

/** IPs are never stored raw: HMAC(IP_HMAC_KEY, ip) (PRD 10.3). */
export function hashIp(ipKey: string, ip: string): Promise<string> {
  return hmac(ipKey, `ip:${ip}`);
}

/** Signed server time: HMAC(TIME_SIGNING_KEY, serverTime || deviceId) (PRD 10.3). */
export function signTime(key: string, serverTime: number, deviceId: string): Promise<string> {
  return hmac(key, `${serverTime}|${deviceId}`);
}

export async function verifyTime(
  key: string,
  serverTime: number,
  deviceId: string,
  sig: string,
): Promise<boolean> {
  return timingSafeEqual(await signTime(key, serverTime, deviceId), sig);
}

// ---- AES-256-GCM for door secrets (QR_MASTER_KEY is 32 bytes base64url) -------------------------

async function aesKey(masterKeyB64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', fromBase64Url(masterKeyB64), 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
}

/** Encrypt bytes; output `iv.ciphertext` (both base64url). */
export async function encryptSecret(
  masterKeyB64: string,
  plain: Uint8Array<ArrayBuffer>,
): Promise<string> {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await aesKey(masterKeyB64),
    plain,
  );
  return `${toBase64Url(iv)}.${toBase64Url(ct)}`;
}

export async function decryptSecret(
  masterKeyB64: string,
  sealed: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const [ivB64, ctB64] = sealed.split('.');
  if (!ivB64 || !ctB64) throw new Error('Malformed sealed secret');
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64Url(ivB64) },
    await aesKey(masterKeyB64),
    fromBase64Url(ctB64),
  );
  return new Uint8Array(pt);
}

// ---- ECDSA P-256 device signatures ---------------------------------------------------------------

/** RFC 7638 JWK thumbprint of an EC public key. */
export async function jwkThumbprint(jwk: {
  crv: string;
  kty: string;
  x: string;
  y: string;
}): Promise<string> {
  const canonical = `{"crv":"${jwk.crv}","kty":"${jwk.kty}","x":"${jwk.x}","y":"${jwk.y}"}`;
  return toBase64Url(await sha256(canonical));
}

/** Verify an ECDSA P-256/SHA-256 signature (IEEE P1363, base64url) over a UTF-8 message. */
export async function verifyDeviceSignature(
  publicJwk: JsonWebKey,
  message: string,
  signatureB64: string,
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      'jwk',
      publicJwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    return await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      fromBase64Url(signatureB64),
      enc.encode(message),
    );
  } catch {
    return false;
  }
}
