/**
 * Owner recovery codes (ADR-19, docs/owner-access.md "Passkeys" flow 5, slice 7 part B): an admin
 * issues a one-time code with `scripts/owner-recovery.mjs --issue-code`; the owner types it on the
 * owner host and gets an enrolment token for a fresh first device. Owner host only.
 *
 * The token is a device request that is already approved (`approved_by_credential = 'recovery'`),
 * so the enrol routes treat it like any other enrolment token and then replace every old passkey.
 * Owner: WP-3.
 */
import { randomToken, sha256Hex, timingSafeEqual } from '../lib/crypto';
import { fail } from '../lib/errors';
import { ulid } from '../lib/ulid';
import { ENROL_WINDOW_MS, enrolTokenHash, REQUEST_TTL_MS } from './owner-devices';
import type { Ctx } from './ports';

/** Marks a device request made by a recovery code (an approving passkey would be an id). */
export const RECOVERY_MARK = 'recovery';

/** Wrong codes: per IP and for the whole salon, in 15 minutes. */
export const RECOVERY_FAILS_PER_IP = { max: 5, windowMs: 15 * 60_000 } as const;
export const RECOVERY_FAILS_PER_ORG = { max: 20, windowMs: 15 * 60_000 } as const;

/** Every refusal says the same, whatever the reason: no code, used, expired, no owner. */
const GONE = 'That code did not work. Check it, or ask for a new one.';

const CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{16}$/;

/** The 16 characters that were issued: case, dashes and spaces ignored, I and L as 1, O as 0. */
export function normalizeRecoveryCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
  return CODE_PATTERN.test(code) ? code : null;
}

/** Stored form; the same value as `recoveryCodeHash` in scripts/owner-recovery-sql.mjs. */
export function recoveryCodeHash(code: string): Promise<string> {
  return sha256Hex(`owner-recovery:${code}`);
}

/** RATE_LIMITED after too many wrong codes lately (counted from the audit rows of wrong codes). */
async function assertRecoveryBudget(ctx: Ctx): Promise<void> {
  const retry = { 'Retry-After': String(RECOVERY_FAILS_PER_IP.windowMs / 1000) };
  const since = ctx.now() - RECOVERY_FAILS_PER_IP.windowMs;
  if (ctx.ipHmac) {
    const byIp = await ctx.db.first<{ n: number }>(
      `SELECT COUNT(*) AS n FROM audit_log
        WHERE org_id = ?org AND action = 'owner.recovery_failed' AND ip_hmac = ? AND created_at > ?`,
      ctx.ipHmac,
      since,
    );
    if ((byIp?.n ?? 0) >= RECOVERY_FAILS_PER_IP.max)
      fail('RATE_LIMITED', undefined, undefined, retry);
  }
  const byOrg = await ctx.db.first<{ n: number }>(
    `SELECT COUNT(*) AS n FROM audit_log
      WHERE org_id = ?org AND action = 'owner.recovery_failed' AND created_at > ?`,
    ctx.now() - RECOVERY_FAILS_PER_ORG.windowMs,
  );
  if ((byOrg?.n ?? 0) >= RECOVERY_FAILS_PER_ORG.max)
    fail('RATE_LIMITED', undefined, undefined, retry);
}

async function refuse(ctx: Ctx, reason: string): Promise<never> {
  await ctx.services.audit.log(ctx, {
    category: 'security',
    action: 'owner.recovery_failed',
    entity: 'owner_recovery_code',
    entityId: null,
    after: { reason },
  });
  return fail('LINK_EXPIRED', GONE);
}

interface CodeRow {
  id: string;
  user_id: string;
  code_hash: string;
  expires_at: number;
  used_at: number | null;
}

/**
 * Redeem a code: single use (one conditional UPDATE), then a token that works for 10 minutes. The
 * caller learns nothing about owners or codes: unknown, expired, used and malformed codes all answer
 * LINK_EXPIRED with the same words, and each one counts toward the rate limit.
 */
export async function redeemRecoveryCode(
  ctx: Ctx,
  input: string,
): Promise<{ enrolToken: string; expiresAt: number }> {
  await assertRecoveryBudget(ctx);
  const code = normalizeRecoveryCode(input);
  // A malformed code takes the same road as a wrong one (a hash of nothing matches no row).
  const hash = await recoveryCodeHash(code ?? '');
  const row = await ctx.db.first<CodeRow>(
    `SELECT c.id, c.user_id, c.code_hash, c.expires_at, c.used_at
       FROM owner_recovery_codes c JOIN users u ON u.id = c.user_id
      WHERE c.org_id = ?org AND c.code_hash = ? AND u.role = 'owner' AND u.status = 'active'`,
    hash,
  );
  const now = ctx.now();
  if (!code || !row || !timingSafeEqual(row.code_hash, hash)) return refuse(ctx, 'unknown');
  if (row.used_at !== null || row.expires_at <= now) return refuse(ctx, 'unusable');

  const claimed = await ctx.db.run(
    `UPDATE owner_recovery_codes SET used_at = ?
      WHERE org_id = ?org AND id = ? AND used_at IS NULL AND expires_at > ?`,
    now,
    row.id,
    now,
  );
  if (claimed.meta.changes !== 1) return refuse(ctx, 'unusable');

  const enrolToken = randomToken(32);
  const requestId = ulid(now);
  await ctx.db.batch([
    ctx.db.insert('owner_device_requests', {
      id: requestId,
      user_id: row.user_id,
      code: '000000',
      device_name: 'Recovery',
      platform: 'other',
      city: null,
      status: 'approved',
      approved_by_credential: RECOVERY_MARK,
      enrol_token_hash: await enrolTokenHash(ctx, enrolToken),
      ip_hmac: ctx.ipHmac,
      expires_at: now + REQUEST_TTL_MS,
      decided_at: now,
      created_at: now,
    }),
    ctx.services.audit.stmt(ctx, {
      category: 'security',
      action: 'owner.recovery_used',
      entity: 'owner_recovery_code',
      entityId: row.id,
      after: { userId: row.user_id, requestId },
      actorType: 'system',
      actorId: null,
    }),
  ]);
  return { enrolToken, expiresAt: now + ENROL_WINDOW_MS };
}
