/**
 * Door QR tokens (PRD 4.5). The door device and the server compute the same token from the site
 * secret and the 30-second step:
 *
 *   step  = floor(unixTimeMs / 30000)
 *   mac   = HMAC-SHA256(secret, step as an 8-byte big-endian integer)
 *   token = Crockford base32 of mac (big-endian bit order), first 10 characters (50 bits)
 *
 * The server accepts the current and the previous step (a window of at most 60 s). The token never
 * works alone: device signature and PIN are still required, and one person cannot use a step twice.
 * Owner: WP-4. Used by the Worker (validation, "Show door code") and the door kiosk (display).
 */

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export const DOOR_STEP_MS = 30_000;
export const DOOR_TOKEN_LENGTH = 10;

/** The 30-second step of an instant. */
export function doorStep(ts: number): number {
  return Math.floor(ts / DOOR_STEP_MS);
}

function base32(bytes: Uint8Array, chars: number): string {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = ((buffer << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5 && out.length < chars) {
      out += CROCKFORD[(buffer >> (bits - 5)) & 31];
      bits -= 5;
    }
    if (out.length === chars) break;
  }
  return out;
}

/** The token for one step. `secret` is the raw 32-byte site secret. */
export async function doorToken(secret: Uint8Array<ArrayBuffer>, step: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    secret,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const msg = new Uint8Array(8);
  new DataView(msg.buffer).setBigUint64(0, BigInt(step));
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  return base32(mac, DOOR_TOKEN_LENGTH);
}

/** Ten Crockford base32 characters (upper case, no I, L, O, U). */
export function isDoorTokenShape(token: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{10}$/.test(token);
}

function sameToken(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * The step a token belongs to when it matches the current or the previous step at `nowTs`, else
 * null (expired, from another secret, or not a door token).
 */
export async function matchDoorToken(
  secret: Uint8Array<ArrayBuffer>,
  token: string,
  nowTs: number,
): Promise<number | null> {
  if (!isDoorTokenShape(token)) return null;
  const current = doorStep(nowTs);
  for (const step of [current, current - 1]) {
    if (sameToken(await doorToken(secret, step), token)) return step;
  }
  return null;
}
