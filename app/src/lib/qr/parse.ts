/**
 * Door QR parsing (PRD 4.5). The door screen and the owner's "Show door code" encode
 * `https://<host>/q/<siteId>/<token>`; the scanner accepts only codes for this app's own host.
 */
import { normaliseCode } from '@fs/contracts';
import { isDoorTokenShape } from '@fs/engine';

export const DOOR_TOKEN_LENGTH = 10;

export type DoorUrlError =
  /** Any other QR code (another site, a payment code, a menu link...): "That's not the door code." */
  | 'not_ours'
  /** Our door URL, but the site id or the token is malformed. */
  | 'bad_token';

export type DoorUrlParse =
  | { ok: true; siteId: string; token: string }
  | { ok: false; error: DoorUrlError };

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

/**
 * A typed or scanned door code: upper case, separators dropped, I/L read as 1 and O as 0
 * (`normaliseCode(input, 10)`), then checked against the token alphabet. Null when it is not one.
 */
export function normaliseDoorToken(input: string): string | null {
  const code = normaliseCode(input, DOOR_TOKEN_LENGTH);
  return code && isDoorTokenShape(code) ? code : null;
}

/**
 * Parse scanned QR text. `host` defaults to `location.host`; the URL must be https (http only on
 * localhost for E2E), on that exact host, with the path `/q/<siteId>/<token>`.
 */
export function parseDoorUrl(text: string, host: string = location.host): DoorUrlParse {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return { ok: false, error: 'not_ours' };
  }
  const secure =
    url.protocol === 'https:' || (url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname));
  if (!secure || url.host !== host || url.username || url.password) {
    return { ok: false, error: 'not_ours' };
  }
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'q') return { ok: false, error: 'not_ours' };
  const [, siteId, rawToken, ...rest] = parts;
  if (!siteId || !rawToken || rest.length > 0) return { ok: false, error: 'bad_token' };
  let decodedToken: string;
  try {
    decodedToken = decodeURIComponent(rawToken);
  } catch {
    return { ok: false, error: 'bad_token' };
  }
  const token = normaliseDoorToken(decodedToken);
  if (!ULID.test(siteId) || !token) return { ok: false, error: 'bad_token' };
  return { ok: true, siteId, token };
}

/** The URL a door screen shows for a token. */
export function doorUrl(origin: string, siteId: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/q/${siteId}/${token}`;
}
