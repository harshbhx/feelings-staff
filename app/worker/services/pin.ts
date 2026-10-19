/**
 * PINs (PRD 4.1.4, 4.1.6, 9.3, 10.3): hashing, verification and lockouts. Owner: WP-3.
 *
 * - Hash: HMAC-SHA256(PIN_PEPPER, salt || pin) with a 16-byte random salt per user.
 * - 5 wrong tries in a row lock the account for 15 minutes (423 PIN_LOCKED with `until`).
 * - 10 wrong tries within 24 hours alert the owner once (N21 `pin_attempts`).
 * Staff and owner PINs share these rules; a wrong owner password counts as a wrong try too.
 */
import { istTime, type Role } from '@fs/contracts';
import { hashPin, randomToken, timingSafeEqual } from '../lib/crypto';
import { fail } from '../lib/errors';
import type { Ctx } from './ports';

export const PIN_MAX_TRIES = 5;
export const PIN_LOCK_MS = 15 * 60_000;
export const PIN_ALERT_AT = 10;
export const PIN_ALERT_WINDOW_MS = 24 * 60 * 60_000;

export interface PinUser {
  id: string;
  name: string;
  role: Role;
  pin_hash: string | null;
  pin_salt: string | null;
  pin_failures: number;
  pin_locked_until: number | null;
}

/** A fresh salt and hash for a new PIN. */
export async function newPinHash(ctx: Ctx, pin: string): Promise<{ hash: string; salt: string }> {
  const salt = randomToken(16);
  return { hash: await hashPin(ctx.env.PIN_PEPPER, salt, pin), salt };
}

export function lockedMessage(until: number): string {
  return `Too many wrong tries. Try again at ${istTime(until)}.`;
}

/** 423 PIN_LOCKED while a lock is running. */
export function assertNotLocked(ctx: Ctx, u: Pick<PinUser, 'pin_locked_until'>): void {
  if (u.pin_locked_until !== null && u.pin_locked_until > ctx.now())
    fail('PIN_LOCKED', lockedMessage(u.pin_locked_until), { until: u.pin_locked_until });
}

const DUMMY_SALT = 'AAAAAAAAAAAAAAAAAAAAAA';

/** Constant-work comparison; a user without a PIN never matches. */
export async function pinMatches(ctx: Ctx, u: PinUser | null, pin: string): Promise<boolean> {
  if (!u?.pin_hash || !u.pin_salt) {
    await hashPin(ctx.env.PIN_PEPPER, DUMMY_SALT, pin);
    return false;
  }
  return timingSafeEqual(await hashPin(ctx.env.PIN_PEPPER, u.pin_salt, pin), u.pin_hash);
}

export interface FailureResult {
  locked: boolean;
  until: number | null;
  triesLeft: number;
  failures24h: number;
}

/**
 * Count one wrong try: lock after 5 in a row, alert the owner at 10 in 24 h, audit both.
 * `what` names the credential in the audit row.
 */
export async function recordPinFailure(
  ctx: Ctx,
  u: PinUser,
  what: 'pin' | 'password' = 'pin',
): Promise<FailureResult> {
  const now = ctx.now();
  const cut = now - PIN_ALERT_WINDOW_MS;
  const row = await ctx.db.first<{ pin_failures: number; pin_failures_24h: number }>(
    `UPDATE users SET
        pin_failures = pin_failures + 1,
        pin_failures_24h = CASE WHEN pin_window_start IS NULL OR pin_window_start <= ? THEN 1
                                ELSE pin_failures_24h + 1 END,
        pin_window_start = CASE WHEN pin_window_start IS NULL OR pin_window_start <= ? THEN ?
                                ELSE pin_window_start END,
        updated_at = ?
      WHERE org_id = ?org AND id = ?
      RETURNING pin_failures, pin_failures_24h`,
    cut,
    cut,
    now,
    now,
    u.id,
  );
  const failures = row?.pin_failures ?? u.pin_failures + 1;
  const failures24h = row?.pin_failures_24h ?? 1;
  const locked = failures >= PIN_MAX_TRIES;
  const until = locked ? now + PIN_LOCK_MS : null;
  const audit = ctx.services.audit;
  const stmts: D1PreparedStatement[] = [
    audit.stmt(ctx, {
      category: 'security',
      action: what === 'pin' ? 'auth.pin_wrong' : 'auth.password_wrong',
      entity: 'user',
      entityId: u.id,
      after: { failures, failures24h },
      actorType: 'user',
      actorId: null,
    }),
  ];
  if (locked) {
    stmts.push(
      ctx.db.update('users', { pin_locked_until: until, pin_failures: 0 }, 'id = ?', u.id),
      audit.stmt(ctx, {
        category: 'security',
        action: 'auth.pin_locked',
        entity: 'user',
        entityId: u.id,
        after: { until },
        actorType: 'system',
        actorId: null,
      }),
    );
  }
  await ctx.db.batch(stmts);
  if (failures24h === PIN_ALERT_AT && ctx.orgId) {
    await ctx.services.notifier.emit(ctx, {
      type: 'pin_attempts',
      orgId: ctx.orgId,
      at: now,
      userId: u.id,
      name: u.name,
      count: failures24h,
    });
  }
  return { locked, until, triesLeft: locked ? 0 : PIN_MAX_TRIES - failures, failures24h };
}

/** Clear the consecutive-failure counter and any lock after a correct PIN. */
export async function recordPinSuccess(ctx: Ctx, u: PinUser): Promise<void> {
  if (u.pin_failures === 0 && u.pin_locked_until === null) return;
  await ctx.db.run(
    'UPDATE users SET pin_failures = 0, pin_locked_until = NULL, updated_at = ? WHERE org_id = ?org AND id = ?',
    ctx.now(),
    u.id,
  );
}

export function wrongPinMessage(triesLeft: number): string {
  return `Wrong PIN. ${triesLeft} ${triesLeft === 1 ? 'try' : 'tries'} left.`;
}

/** Throw the right error for a failure result (PIN_LOCKED or PIN_WRONG with tries left). */
export function failForPin(r: FailureResult): never {
  if (r.locked && r.until !== null) fail('PIN_LOCKED', lockedMessage(r.until), { until: r.until });
  fail('PIN_WRONG', wrongPinMessage(r.triesLeft), { triesLeft: r.triesLeft });
}

/** Check a PIN with lockouts: returns on success, throws PIN_LOCKED / PIN_WRONG otherwise. */
export async function verifyPinOrThrow(ctx: Ctx, u: PinUser, pin: string): Promise<void> {
  assertNotLocked(ctx, u);
  if (await pinMatches(ctx, u, pin)) {
    await recordPinSuccess(ctx, u);
    return;
  }
  failForPin(await recordPinFailure(ctx, u, 'pin'));
}
