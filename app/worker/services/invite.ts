/**
 * Invites and join codes (PRD 4.1.1-4.1.4, 4.1.6, 10.3). Owner: WP-3.
 *
 * - Code: 8 Crockford base32 characters, shown as XXX-XXXXX, single use, 48 hours.
 * - Stored only as HMAC(SESSION_SECRET, code) in `invites.code_hash`.
 * - A new invite for a person revokes the old one. Purpose `pin_reset` keeps devices approved.
 * - Wrong codes are counted per phone (5 per hour, then 429) in the security audit log.
 */
import { formatJoinCode, type InviteView, normaliseCode, type UserStatus } from '@fs/contracts';
import { hashCode, hmac, randomCode } from '../lib/crypto';
import { fail } from '../lib/errors';
import { ulid } from '../lib/ulid';
import type { Ctx } from './ports';

export const INVITE_TTL_MS = 48 * 60 * 60_000;
export const JOIN_TRIES_PER_HOUR = 5;
const HOUR_MS = 60 * 60_000;

export type InvitePurpose = 'join' | 'pin_reset';

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** The WhatsApp message (PRD 4.1.2). WhatsApp renders *text* in bold. */
export function inviteMessage(opts: {
  staffName: string;
  ownerName: string;
  orgName: string;
  url: string;
  code: string;
  purpose: InvitePurpose;
}): string {
  const hi = `Hi ${firstName(opts.staffName)}, this is ${opts.ownerName} from ${opts.orgName}.`;
  if (opts.purpose === 'pin_reset') {
    return [
      `${hi} I've reset your staff app PIN:`,
      opts.url,
      `Your code is *${opts.code}*. Open the Feelings app, tap Join, type the code and pick a new PIN.`,
      'The code works for 48 hours.',
    ].join('\n');
  }
  return [
    `${hi} Please join our staff app:`,
    opts.url,
    `Your join code is *${opts.code}*. First add the app to your home screen, then open it and type the code.`,
    'The link works for 48 hours.',
  ].join('\n');
}

export function inviteView(opts: {
  origin: string;
  rawCode: string;
  staffName: string;
  staffPhone: string | null;
  ownerName: string;
  orgName: string;
  expiresAt: number;
  purpose: InvitePurpose;
}): InviteView {
  const url = `${opts.origin}/join/${opts.rawCode}`;
  const code = formatJoinCode(opts.rawCode);
  const message = inviteMessage({
    staffName: opts.staffName,
    ownerName: opts.ownerName,
    orgName: opts.orgName,
    url,
    code,
    purpose: opts.purpose,
  });
  const to = (opts.staffPhone ?? '').replace(/\D/g, '');
  return {
    url,
    code,
    message,
    waLink: `https://wa.me/${to}?text=${encodeURIComponent(message)}`,
    expiresAt: opts.expiresAt,
    purpose: opts.purpose,
  };
}

export function codeHash(ctx: Ctx, rawCode: string): Promise<string> {
  return hashCode(ctx.env.SESSION_SECRET, rawCode);
}

/**
 * Statements that issue a new invite for a person (revoking any open one) and its view.
 * `ctx` must be bound to the person's org.
 */
export async function issueInvite(
  ctx: Ctx,
  opts: {
    user: { id: string; name: string; phone: string | null };
    purpose: InvitePurpose;
    org: { name: string; ownerDisplayName: string };
    createdBy: string;
  },
): Promise<{ id: string; view: InviteView; stmts: D1PreparedStatement[] }> {
  const now = ctx.now();
  const rawCode = randomCode(8);
  const id = ulid(now);
  const expiresAt = now + INVITE_TTL_MS;
  const stmts = [
    ctx.db.stmt(
      `UPDATE invites SET revoked_at = ? WHERE org_id = ?org AND user_id = ? AND used_at IS NULL
          AND revoked_at IS NULL`,
      now,
      opts.user.id,
    ),
    ctx.db.insert('invites', {
      id,
      user_id: opts.user.id,
      code_hash: await codeHash(ctx, rawCode),
      purpose: opts.purpose,
      expires_at: expiresAt,
      created_by: opts.createdBy,
      created_at: now,
    }),
  ];
  const view = inviteView({
    origin: ctx.env.APP_ORIGIN,
    rawCode,
    staffName: opts.user.name,
    staffPhone: opts.user.phone,
    ownerName: opts.org.ownerDisplayName,
    orgName: opts.org.name,
    expiresAt,
    purpose: opts.purpose,
  });
  return { id, view, stmts };
}

/** Statement that revokes every open invite of a person (exit). */
export function revokeInvitesStmt(ctx: Ctx, userId: string): D1PreparedStatement {
  return ctx.db.stmt(
    'UPDATE invites SET revoked_at = ? WHERE org_id = ?org AND user_id = ? AND used_at IS NULL AND revoked_at IS NULL',
    ctx.now(),
    userId,
  );
}

export interface InviteLookup {
  id: string;
  org_id: string;
  user_id: string;
  purpose: InvitePurpose;
  expires_at: number;
  used_at: number | null;
  revoked_at: number | null;
  user_name: string;
  user_phone: string | null;
  user_status: UserStatus;
  user_role: 'owner' | 'manager' | 'staff';
  user_lang: 'en' | 'gu';
}

export type InviteState = 'valid' | 'expired' | 'used';

export function inviteState(row: InviteLookup, now: number): InviteState {
  if (row.used_at !== null) return 'used';
  if (row.revoked_at !== null || row.expires_at <= now || row.user_status === 'exited')
    return 'expired';
  return 'valid';
}

/** Find an invite by a typed code (any case, with or without the dash). Pre-auth lookup. */
export async function findInvite(ctx: Ctx, typed: string): Promise<InviteLookup | null> {
  const raw = normaliseCode(typed, 8);
  if (!raw) return null;
  return ctx.sys.first<InviteLookup>(
    `SELECT i.id, i.org_id, i.user_id, i.purpose, i.expires_at, i.used_at, i.revoked_at,
            u.name AS user_name, u.phone_e164 AS user_phone, u.status AS user_status,
            u.role AS user_role, u.lang AS user_lang
       FROM invites i JOIN users u ON u.id = i.user_id
      WHERE i.code_hash = ?1`,
    await codeHash(ctx, raw),
  );
}

// ---- Wrong-code counting per phone (PRD 9.3) -----------------------------------------------------

async function phoneKey(ctx: Ctx, phone: string): Promise<string> {
  return hmac(ctx.env.SESSION_SECRET, `join-phone:${phone}`);
}

/** 429 when this phone already had 5 wrong codes in the last hour. */
export async function assertJoinTriesLeft(ctx: Ctx, phone: string): Promise<number> {
  const now = ctx.now();
  const row = await ctx.db.first<{ n: number; first: number | null }>(
    `SELECT COUNT(*) AS n, MIN(created_at) AS first FROM audit_log
      WHERE org_id = ?org AND entity = 'join_phone' AND entity_id = ? AND action = 'join.code_wrong'
        AND created_at > ?`,
    await phoneKey(ctx, phone),
    now - HOUR_MS,
  );
  const n = row?.n ?? 0;
  if (n >= JOIN_TRIES_PER_HOUR) {
    const retryMs = (row?.first ?? now) + HOUR_MS - now;
    const retryAfter = Math.max(1, Math.ceil(retryMs / 1000));
    fail(
      'RATE_LIMITED',
      'Too many tries. Wait an hour or ask for a new invite.',
      { retryAfterSec: retryAfter },
      { 'Retry-After': String(retryAfter) },
    );
  }
  return JOIN_TRIES_PER_HOUR - n;
}

/** Record a wrong code for this phone and answer 401 CODE_WRONG with the tries left. */
export async function failWrongCode(ctx: Ctx, phone: string, triesBefore: number): Promise<never> {
  await ctx.services.audit.log(ctx, {
    category: 'security',
    action: 'join.code_wrong',
    entity: 'join_phone',
    entityId: await phoneKey(ctx, phone),
    actorType: 'user',
    actorId: null,
  });
  const triesLeft = Math.max(0, triesBefore - 1);
  return fail('CODE_WRONG', "That code doesn't match this number.", { triesLeft });
}
