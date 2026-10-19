/**
 * RFC 8785 (JCS) canonical JSON for the values we sign: objects with string keys, arrays, strings,
 * finite numbers, booleans and null. Keys are sorted by UTF-16 code units (JS default sort);
 * numbers use the ECMAScript shortest form (what JSON.stringify produces). `undefined` object members
 * are dropped, as JSON.stringify does.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
    case 'string':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('Cannot canonicalise a non-finite number');
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(',')}]`;
      }
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
    }
    default:
      throw new TypeError(`Cannot canonicalise a ${typeof value}`);
  }
}

/** The part of a PunchRequest that is signed: everything except signature, pin and pinEnvelope. */
export function punchSigningPayload(req: {
  signature?: unknown;
  pin?: unknown;
  offline?: ({ pinEnvelope?: unknown } & Record<string, unknown>) | null;
  [k: string]: unknown;
}): string {
  const omit = (o: Record<string, unknown>, keys: string[]) =>
    Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
  const signed = omit(req, ['signature', 'pin']);
  signed.offline = req.offline ? omit(req.offline, ['pinEnvelope']) : null;
  return canonicalJson(signed);
}

/** Bytes to base64url (no padding). */
export function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (const b of u8) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** base64url (with or without padding) to bytes. */
export function fromBase64Url(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
