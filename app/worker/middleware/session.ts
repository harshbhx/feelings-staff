/**
 * Session cookie (PRD 9.1): `fs_session`, 32 random bytes, HttpOnly, Secure, SameSite=Strict.
 * D1 stores only SHA-256(token). Staff sessions slide for 30 days, owner/manager 14, door 365.
 * Owner: WP-1 (loading). WP-3 calls issueSession/revokeSession from its auth routes.
 */
import { Permission, type Role, toBase64Url } from '@fs/contracts';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { SystemDb } from '../db';
import { json } from '../db';
import type { AppEnv } from '../lib/app-env';
import { randomToken, sha256 } from '../lib/crypto';
import { fail } from '../lib/errors';
import type { Ctx, SessionInfo, SessionUser } from '../services/ports';

export const SESSION_COOKIE = 'fs_session';
const DAY = 86_400_000;
export const SESSION_TTL_MS = {
  staff: 30 * DAY,
  manager: 14 * DAY,
  owner: 14 * DAY,
  door: 365 * DAY,
} as const;
const SLIDE_AFTER_MS = 60 * 60_000;

export async function hashToken(token: string): Promise<string> {
  return toBase64Url(await sha256(token));
}

interface SessionRow {
  token_hash: string;
  org_id: string;
  kind: 'user' | 'door';
  user_id: string | null;
  device_id: string | null;
  created_at: number;
  last_seen_at: number;
  expires_at: number;
  step_up_until: number | null;
  role: Role | null;
  name: string | null;
  status: SessionUser['status'] | null;
  lang: 'en' | 'gu' | null;
  phone_e164: string | null;
  email: string | null;
  permissions_json: string | null;
}

export interface LoadedSession {
  session: SessionInfo;
  user: SessionUser | null;
}

/** Read and validate the session cookie. Returns null when absent or expired. */
export async function loadSession(
  c: Context<AppEnv>,
  sys: SystemDb,
  now: number,
): Promise<LoadedSession | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token || token.length < 32 || token.length > 64) return null;
  const tokenHash = await hashToken(token);
  let row: SessionRow | null;
  try {
    row = await sys.first<SessionRow>(
      `SELECT s.token_hash, s.org_id, s.kind, s.user_id, s.device_id, s.created_at, s.last_seen_at, s.expires_at,
            s.step_up_until, u.role, u.name, u.status, u.lang, u.phone_e164, u.email, u.permissions_json
       FROM sessions s LEFT JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?1 AND s.revoked_at IS NULL`,
      tokenHash,
    );
  } catch (e) {
    // Before the first test reset the schema may not exist yet; anything else is a real error.
    if (e instanceof Error && e.message.includes('no such table')) return null;
    throw e;
  }
  if (!row || row.expires_at <= now) {
    clearSessionCookie(c);
    return null;
  }
  const session: SessionInfo = {
    tokenHash,
    kind: row.kind,
    orgId: row.org_id,
    userId: row.user_id,
    deviceId: row.device_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    stepUpUntil: row.step_up_until,
  };
  let user: SessionUser | null = null;
  if (row.kind === 'user') {
    if (!row.user_id || !row.role || !row.status) {
      clearSessionCookie(c);
      return null;
    }
    if (row.status === 'exited' || row.status === 'suspended') {
      clearSessionCookie(c);
      fail('ACCOUNT_INACTIVE');
    }
    const permissions: Permission[] =
      row.role === 'owner'
        ? [...Permission.options]
        : row.role === 'manager'
          ? json<string[]>(row.permissions_json, []).filter((p): p is Permission =>
              (Permission.options as readonly string[]).includes(p),
            )
          : [];
    user = {
      id: row.user_id,
      orgId: row.org_id,
      role: row.role,
      name: row.name ?? '',
      status: row.status,
      lang: row.lang ?? 'en',
      phone: row.phone_e164,
      email: row.email,
      permissions,
    };
  }
  if (now - row.last_seen_at > SLIDE_AFTER_MS) {
    const ttl = row.kind === 'door' ? SESSION_TTL_MS.door : SESSION_TTL_MS[user?.role ?? 'staff'];
    c.executionCtx.waitUntil(
      sys
        .run(
          'UPDATE sessions SET last_seen_at = ?1, expires_at = ?2 WHERE token_hash = ?3',
          now,
          now + ttl,
          tokenHash,
        )
        .catch(() => undefined),
    );
  }
  return { session, user };
}

function cookieSecure(c: Context<AppEnv>): boolean {
  return !(c.env.ENV === 'local' && new URL(c.req.url).protocol === 'http:');
}

/**
 * Start a session and set the cookie. Revoke an existing session first when signing in again.
 * Returns the stored token hash.
 */
export async function issueSession(
  ctx: Ctx,
  c: Context<AppEnv>,
  opts: {
    orgId: string;
    kind: 'user' | 'door';
    userId: string | null;
    deviceId: string | null;
    role?: Role;
  },
): Promise<string> {
  const token = randomToken(32);
  const tokenHash = await hashToken(token);
  const now = ctx.now();
  const ttl = opts.kind === 'door' ? SESSION_TTL_MS.door : SESSION_TTL_MS[opts.role ?? 'staff'];
  await ctx.sys.run(
    `INSERT INTO sessions (token_hash, org_id, kind, user_id, device_id, created_at, last_seen_at, expires_at, ip_hmac)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?7, ?8)`,
    tokenHash,
    opts.orgId,
    opts.kind,
    opts.userId,
    opts.deviceId,
    now,
    now + ttl,
    ctx.ipHmac,
  );
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: cookieSecure(c),
    sameSite: 'Strict',
    path: '/',
    maxAge: Math.floor(ttl / 1000),
  });
  return tokenHash;
}

/** Revoke one session by its hash (logout) and clear the cookie when it is the caller's. */
export async function revokeSession(
  ctx: Ctx,
  c: Context<AppEnv> | null,
  tokenHash: string,
): Promise<void> {
  await ctx.sys.run(
    'UPDATE sessions SET revoked_at = ?1 WHERE token_hash = ?2',
    ctx.now(),
    tokenHash,
  );
  if (c && ctx.session?.tokenHash === tokenHash) clearSessionCookie(c);
}

/** Revoke every session of a user, optionally keeping one (sign out others, device revoke, exit). */
export async function revokeUserSessions(
  ctx: Ctx,
  userId: string,
  exceptTokenHash?: string,
): Promise<void> {
  await ctx.sys.run(
    'UPDATE sessions SET revoked_at = ?1 WHERE user_id = ?2 AND revoked_at IS NULL AND token_hash <> ?3',
    ctx.now(),
    userId,
    exceptTokenHash ?? '',
  );
}

export function clearSessionCookie(c: Context<AppEnv>): void {
  deleteCookie(c, SESSION_COOKIE, {
    path: '/',
    secure: cookieSecure(c),
    sameSite: 'Strict',
    httpOnly: true,
  });
}
