/**
 * Small conveniences kept in localStorage by the auth screens. Nothing secret lives here: never a
 * PIN, a key or a session. Every read and write tolerates blocked storage.
 *
 * - `fs.joinCode`: the invite code from `/join/:code`, so the installed Android app can prefill it
 *   (Chrome shares storage with the WebAPK, PRD 4.1.3). Ignored after 48 hours, like the invite.
 * - `fs.org`: the owner's display name and the salon's contact phone, for copy such as
 *   "Ask Urmi to reset your PIN." before anyone is signed in.
 * - `fs.phone`: the last phone number that signed in on this phone, to prefill sign-in.
 */
const JOIN_CODE_KEY = 'fs.joinCode';
const ORG_KEY = 'fs.org';
const PHONE_KEY = 'fs.phone';
const JOIN_CODE_TTL_MS = 48 * 60 * 60 * 1000;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // storage blocked (private mode): the convenience is lost, nothing else
  }
}

export function saveJoinCode(code: string, now = Date.now()): void {
  write(JOIN_CODE_KEY, JSON.stringify({ code, savedAt: now }));
}

export function readJoinCode(now = Date.now()): string | null {
  const raw = read(JOIN_CODE_KEY);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { code?: unknown; savedAt?: unknown };
    if (typeof v.code !== 'string' || typeof v.savedAt !== 'number') return null;
    return now - v.savedAt > JOIN_CODE_TTL_MS ? null : v.code;
  } catch {
    return null;
  }
}

export function clearJoinCode(): void {
  write(JOIN_CODE_KEY, null);
}

export interface OrgContact {
  ownerName: string | null;
  ownerPhone: string | null;
}

export function readOrgContact(): OrgContact {
  const raw = read(ORG_KEY);
  const empty: OrgContact = { ownerName: null, ownerPhone: null };
  if (!raw) return empty;
  try {
    const v = JSON.parse(raw) as Partial<Record<keyof OrgContact, unknown>>;
    return {
      ownerName: typeof v.ownerName === 'string' ? v.ownerName : null,
      ownerPhone: typeof v.ownerPhone === 'string' ? v.ownerPhone : null,
    };
  } catch {
    return empty;
  }
}

/** Merge what we learnt (null or missing values keep the old ones). */
export function saveOrgContact(next: {
  ownerName?: string | null;
  ownerPhone?: string | null;
}): void {
  const old = readOrgContact();
  write(
    ORG_KEY,
    JSON.stringify({
      ownerName: next.ownerName ?? old.ownerName,
      ownerPhone: next.ownerPhone ?? old.ownerPhone,
    }),
  );
}

export function saveLastPhone(e164: string): void {
  write(PHONE_KEY, e164);
}

export function readLastPhone(): string | null {
  return read(PHONE_KEY);
}
