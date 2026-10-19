/**
 * Auth building blocks (PRD 4.1, 9.4, 10.3): org-bound contexts for public routes, the `Me` view,
 * owner lookup, magic links and the 6-digit code. Owner: WP-3.
 */
import {
  type ConsentKind,
  type DeviceStatus,
  type Lang,
  type Me,
  Permission,
  type Role,
  type UserStatus,
} from '@fs/contracts';
import { bool, json } from '../db';
import { hashCode, hashPassword, randomDigits, randomToken, timingSafeEqual } from '../lib/crypto';
import { fail } from '../lib/errors';
import { loadOrg } from '../lib/settings';
import { ulid } from '../lib/ulid';
import type { Ctx } from './ports';

// ---- Org-bound context ---------------------------------------------------------------------------

/**
 * The same request context bound to `orgId` (public routes learn the org from an invite, a link or
 * an email). Returns `ctx` itself when it is already bound to that org.
 */
export function withOrg(ctx: Ctx, orgId: string): Ctx {
  if (ctx.orgId === orgId) return ctx;
  return {
    env: ctx.env,
    requestId: ctx.requestId,
    now: ctx.now,
    session: ctx.session,
    user: ctx.user,
    orgId,
    db: ctx.sys.forOrg(orgId),
    sys: ctx.sys,
    ip: ctx.ip,
    ipHmac: ctx.ipHmac,
    cf: ctx.cf,
    waitUntil: ctx.waitUntil,
    services: ctx.services,
  };
}

/** The org of a public request; 404 before `/setup` has created one. */
export function requireOrg(ctx: Ctx): string {
  if (!ctx.orgId) fail('NOT_FOUND', 'The salon is not set up yet.');
  return ctx.orgId;
}

// ---- Me -----------------------------------------------------------------------------------------

interface MeRow {
  id: string;
  org_id: string;
  role: Role;
  name: string;
  status: UserStatus;
  phone_e164: string | null;
  email: string | null;
  lang: Lang;
  pin_set: number;
  password_set: number;
  permissions_json: string | null;
  designation: string | null;
  join_date: string | null;
  selfie_required: number | null;
  strong_mode: number | null;
}

/** Permissions for a role: the owner has all, a manager the granted ones, staff none. */
export function permissionsFor(role: Role, permissionsJson: string | null): Permission[] {
  if (role === 'owner') return [...Permission.options];
  if (role !== 'manager') return [];
  return json<unknown[]>(permissionsJson, []).filter((p): p is Permission =>
    (Permission.options as readonly unknown[]).includes(p),
  );
}

/**
 * Build `Me` for a user and the session they hold (PRD 9.4 `GET /me`). `ctx` must be bound to the
 * user's org (see `withOrg`).
 */
export async function buildMe(
  ctx: Ctx,
  userId: string,
  session: { deviceId: string | null; stepUpUntil: number | null },
): Promise<Me> {
  const [row, orgInfo, ownerPhone] = await Promise.all([
    ctx.db.first<MeRow>(
      `SELECT u.id, u.org_id, u.role, u.name, u.status, u.phone_e164, u.email, u.lang,
              u.pin_hash IS NOT NULL AS pin_set, u.password_hash IS NOT NULL AS password_set,
              u.permissions_json, p.designation, p.join_date, p.selfie_required, p.strong_mode
         FROM users u LEFT JOIN staff_profiles p ON p.user_id = u.id
        WHERE u.org_id = ?org AND u.id = ?`,
      userId,
    ),
    loadOrg(ctx),
    ctx.db.first<{ phone_e164: string | null }>(
      `SELECT phone_e164 FROM users WHERE org_id = ?org AND role = 'owner' AND status = 'active'
        ORDER BY created_at LIMIT 1`,
    ),
  ]);
  if (!row) fail('UNAUTHENTICATED');
  const { org, settings } = orgInfo;
  const isOwner = row.role === 'owner';
  const staffLike = !isOwner;

  const [device, consents, enrol] = await Promise.all([
    session.deviceId
      ? ctx.db.first<{
          id: string;
          label: string;
          status: DeviceStatus;
          approved_at: number | null;
        }>(
          'SELECT id, label, status, approved_at FROM devices WHERE org_id = ?org AND id = ? AND user_id = ?',
          session.deviceId,
          userId,
        )
      : Promise.resolve(null),
    staffLike
      ? ctx.db.all<{ kind: ConsentKind; version: string }>(
          'SELECT kind, version FROM consents WHERE org_id = ?org AND user_id = ? AND withdrawn_at IS NULL',
          userId,
        )
      : Promise.resolve([]),
    staffLike && session.deviceId
      ? ctx.db.first<{ after_json: string | null }>(
          `SELECT after_json FROM audit_log WHERE org_id = ?org AND entity = 'device' AND entity_id = ?
              AND action = 'device.enrol' ORDER BY created_at DESC LIMIT 1`,
          session.deviceId,
        )
      : Promise.resolve(null),
  ]);

  const selfieRequired = staffLike
    ? row.selfie_required === null
      ? settings.attendance.selfieOnCheckIn
      : bool(row.selfie_required)
    : false;
  const has = (kind: ConsentKind, version?: string) =>
    consents.some((c) => c.kind === kind && (version === undefined || c.version === version));
  const consentsNeeded: ConsentKind[] = [];
  if (staffLike) {
    if (!has('privacy_notice', settings.privacy.noticeVersion))
      consentsNeeded.push('privacy_notice');
    if (selfieRequired && !has('selfie')) consentsNeeded.push('selfie');
    if (settings.pay.fines.enabled && !has('fines_notice')) consentsNeeded.push('fines_notice');
  }
  const now = ctx.now();
  const stepUpUntil =
    row.role !== 'staff' && session.stepUpUntil !== null && session.stepUpUntil > now
      ? session.stepUpUntil
      : null;

  return {
    user: {
      id: row.id,
      name: row.name,
      role: row.role,
      status: row.status,
      phone: row.phone_e164,
      email: row.email,
      lang: row.lang,
      designation: row.designation,
      joinDate: row.join_date,
    },
    org: {
      id: org.id,
      name: org.name,
      ownerDisplayName: org.owner_display_name,
      contactPhone: ownerPhone?.phone_e164 ?? org.phone_e164,
      timezone: 'Asia/Kolkata',
    },
    device: device
      ? {
          id: device.id,
          label: device.label,
          status: device.status,
          approvedAt: device.approved_at,
        }
      : null,
    permissions: permissionsFor(row.role, row.permissions_json),
    flags: {
      selfieRequired,
      selfieOnCheckOut: selfieRequired && settings.attendance.selfieOnCheckOut,
      strongMode: settings.attendance.strongMode || bool(row.strong_mode),
      breakPunches: settings.attendance.breakPunches,
      pinEveryPunch: settings.attendance.pinEveryPunch,
      showPayslips: isOwner || row.role === 'manager' || settings.pay.showPayslipsToStaff,
      consentsNeeded,
      ownerPinSet: isOwner && bool(row.pin_set),
      ownerPasswordSet: isOwner && bool(row.password_set),
      setupIncomplete: isOwner && Object.values(settings.setup).some((s) => s === 'todo'),
      stepUpUntil,
      storageTip:
        json<{ storagePersisted?: boolean }>(enrol?.after_json, {}).storagePersisted === false,
    },
  };
}

// ---- Owner accounts -----------------------------------------------------------------------------

export interface CredentialRow {
  id: string;
  org_id: string;
  role: Role;
  name: string;
  status: UserStatus;
  email: string | null;
  phone_e164: string | null;
  pin_hash: string | null;
  pin_salt: string | null;
  pin_failures: number;
  pin_locked_until: number | null;
  password_hash: string | null;
  password_salt: string | null;
  password_iter: number | null;
}

export const CREDENTIAL_COLUMNS =
  'id, org_id, role, name, status, email, phone_e164, pin_hash, pin_salt, pin_failures, pin_locked_until, password_hash, password_salt, password_iter';

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** The active owner with this email (any org), or null. Pre-auth lookup through SystemDb. */
export async function findOwnerByEmail(ctx: Ctx, email: string): Promise<CredentialRow | null> {
  return ctx.sys.first<CredentialRow>(
    `SELECT ${CREDENTIAL_COLUMNS} FROM users WHERE email = ?1 AND role = 'owner' AND status = 'active'`,
    normaliseEmail(email),
  );
}

const DUMMY_SALT = 'AAAAAAAAAAAAAAAAAAAAAA';

/** Check an owner password; for a missing account it still spends the same PBKDF2 time. */
export async function passwordMatches(
  ctx: Ctx,
  row: CredentialRow | null,
  password: string,
): Promise<boolean> {
  if (!row?.password_hash || !row.password_salt) {
    await hashPassword(ctx.env.PIN_PEPPER, DUMMY_SALT, password);
    return false;
  }
  const hash = await hashPassword(
    ctx.env.PIN_PEPPER,
    row.password_salt,
    password,
    row.password_iter ?? undefined,
  );
  return timingSafeEqual(hash, row.password_hash);
}

// ---- Magic links (PRD 4.1.7, 9.3) ---------------------------------------------------------------

export const MAGIC_TTL_MS = 15 * 60_000;
export const MAGIC_MAX_CODE_TRIES = 5;
export const MAGIC_PER_EMAIL = { max: 3, windowMs: 15 * 60_000 } as const;
export const MAGIC_PER_IP = { max: 10, windowMs: 60 * 60_000 } as const;

interface MagicRow {
  id: string;
  email: string;
  token_hash: string;
  code_hash: string;
  attempts: number;
  expires_at: number;
  used_at: number | null;
}

const tokenHashOf = (ctx: Ctx, token: string) => hashCode(ctx.env.SESSION_SECRET, `magic:${token}`);
const codeHashOf = (ctx: Ctx, linkId: string, code: string) =>
  hashCode(ctx.env.SESSION_SECRET, `magic-code:${linkId}:${code}`);

/** True when another link may be sent to this email from this IP (3 per 15 min, 10 per IP hour). */
export async function magicLinkAllowed(ctx: Ctx, email: string): Promise<boolean> {
  const now = ctx.now();
  const byEmail = await ctx.sys.first<{ n: number }>(
    'SELECT COUNT(*) AS n FROM magic_links WHERE email = ?1 AND created_at > ?2',
    email,
    now - MAGIC_PER_EMAIL.windowMs,
  );
  if ((byEmail?.n ?? 0) >= MAGIC_PER_EMAIL.max) return false;
  if (ctx.ipHmac) {
    const byIp = await ctx.sys.first<{ n: number }>(
      'SELECT COUNT(*) AS n FROM magic_links WHERE ip_hmac = ?1 AND created_at > ?2',
      ctx.ipHmac,
      now - MAGIC_PER_IP.windowMs,
    );
    if ((byIp?.n ?? 0) >= MAGIC_PER_IP.max) return false;
  }
  return true;
}

/** Create a link + 6-digit code for an email; older unused links for it stop working. */
export async function createMagicLink(
  ctx: Ctx,
  email: string,
): Promise<{ token: string; code: string; expiresAt: number }> {
  const now = ctx.now();
  const id = ulid(now);
  const token = randomToken(32);
  const code = randomDigits(6);
  const expiresAt = now + MAGIC_TTL_MS;
  await ctx.sys.batch([
    ctx.sys.stmt(
      'UPDATE magic_links SET used_at = ?1 WHERE email = ?2 AND used_at IS NULL',
      now,
      email,
    ),
    ctx.sys.stmt(
      `INSERT INTO magic_links (id, email, token_hash, code_hash, attempts, expires_at, ip_hmac, created_at)
       VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6, ?7)`,
      id,
      email,
      await tokenHashOf(ctx, token),
      await codeHashOf(ctx, id, code),
      expiresAt,
      ctx.ipHmac,
      now,
    ),
  ]);
  return { token, code, expiresAt };
}

const LINK_EXPIRED_MSG = 'This link has expired. Send a new one.';

/**
 * Redeem a link token or an email + code. Returns the email it was sent to. Wrong codes count
 * against the link; the 5th kills it. Expired, used, unknown or killed links answer LINK_EXPIRED.
 */
export async function redeemMagic(
  ctx: Ctx,
  input: { token: string } | { email: string; code: string },
): Promise<string> {
  const now = ctx.now();
  let link: MagicRow | null;
  if ('token' in input) {
    link = await ctx.sys.first<MagicRow>(
      'SELECT * FROM magic_links WHERE token_hash = ?1',
      await tokenHashOf(ctx, input.token),
    );
    if (!link || link.used_at !== null || link.expires_at <= now)
      fail('LINK_EXPIRED', LINK_EXPIRED_MSG);
  } else {
    link = await ctx.sys.first<MagicRow>(
      `SELECT * FROM magic_links WHERE email = ?1 AND used_at IS NULL AND expires_at > ?2
        ORDER BY created_at DESC LIMIT 1`,
      normaliseEmail(input.email),
      now,
    );
    if (!link) fail('LINK_EXPIRED', LINK_EXPIRED_MSG);
    const ok = timingSafeEqual(await codeHashOf(ctx, link.id, input.code), link.code_hash);
    if (!ok) {
      const attempts = link.attempts + 1;
      const dead = attempts >= MAGIC_MAX_CODE_TRIES;
      await ctx.sys.run(
        'UPDATE magic_links SET attempts = ?1, used_at = ?2 WHERE id = ?3',
        attempts,
        dead ? now : null,
        link.id,
      );
      const triesLeft = MAGIC_MAX_CODE_TRIES - attempts;
      fail(
        'CODE_WRONG',
        triesLeft > 0
          ? `That code doesn't match. ${triesLeft} ${triesLeft === 1 ? 'try' : 'tries'} left.`
          : "That code doesn't match. Send a new one.",
        { triesLeft },
      );
    }
  }
  const claimed = await ctx.sys.run(
    'UPDATE magic_links SET used_at = ?1 WHERE id = ?2 AND used_at IS NULL',
    now,
    link.id,
  );
  if (claimed.meta.changes !== 1) fail('LINK_EXPIRED', LINK_EXPIRED_MSG);
  return link.email;
}

/** The N31 email (PRD 6): subject carries the code; the body has the code and the link. */
export function magicEmail(opts: { origin: string; name: string; token: string; code: string }): {
  subject: string;
  text: string;
} {
  const first = opts.name.trim().split(/\s+/)[0] ?? opts.name;
  const link = `${opts.origin}/auth/owner?t=${encodeURIComponent(opts.token)}`;
  return {
    subject: `Your Feelings Staff sign-in code: ${opts.code}`,
    text: [
      `Hi ${first},`,
      '',
      `Your sign-in code is ${opts.code}. Type it in the Feelings Staff app, or open this link:`,
      link,
      '',
      'The code and the link work once, for 15 minutes.',
      "If you didn't ask to sign in, you can ignore this email.",
    ].join('\n'),
  };
}
