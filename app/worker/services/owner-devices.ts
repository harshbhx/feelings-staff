/**
 * Owner devices (ADR-19, docs/owner-access.md "Passkeys", flows 3 and 4): device requests from a new
 * device, the single-use enrolment token they carry, and the fingerprint on this device that approve
 * and remove need. Owner host only, like everything passkey (the routes answer 404 elsewhere).
 * Owner: WP-3.
 */
import type {
  OwnerDeviceRequestState,
  OwnerDeviceRequestStatus,
  OwnerDeviceRequestView,
  PasskeyAssertion,
  Platform,
} from '@fs/contracts';
import { hmac } from '../lib/crypto';
import { fail } from '../lib/errors';
import {
  claimChallenge,
  PASSKEY_COLUMNS,
  type PasskeyRow,
  type RelyingParty,
  rejectPasskey,
  verifyAssertion,
} from './passkey';
import type { Ctx } from './ports';

/** A request waits 15 minutes for an approved device to decide. */
export const REQUEST_TTL_MS = 15 * 60_000;
/** After approval the new device has 10 minutes to create its passkey. */
export const ENROL_WINDOW_MS = 10 * 60_000;
/** "Add this device" budget: per IP and for the whole salon. */
export const REQUESTS_PER_IP = { max: 5, windowMs: 15 * 60_000 } as const;
export const REQUESTS_PER_ORG = { max: 20, windowMs: 15 * 60_000 } as const;

const CHALLENGE_GONE = 'That took too long. Try again.';

export interface DeviceRequestRow {
  id: string;
  user_id: string | null;
  code: string;
  device_name: string;
  platform: Platform;
  city: string | null;
  status: OwnerDeviceRequestStatus;
  approved_by_credential: string | null;
  expires_at: number;
  decided_at: number | null;
  used_at: number | null;
  created_at: number;
}

export const REQUEST_COLUMNS =
  'id, user_id, code, device_name, platform, city, status, approved_by_credential, expires_at, decided_at, used_at, created_at';

/** The token is never stored: only HMAC(SESSION_SECRET, token). */
export function enrolTokenHash(ctx: Ctx, token: string): Promise<string> {
  return hmac(ctx.env.SESSION_SECRET, `owner-enrol:${token}`);
}

export async function requestByToken(ctx: Ctx, token: string): Promise<DeviceRequestRow | null> {
  return ctx.db.first<DeviceRequestRow>(
    `SELECT ${REQUEST_COLUMNS} FROM owner_device_requests WHERE org_id = ?org AND enrol_token_hash = ?`,
    await enrolTokenHash(ctx, token),
  );
}

/** A pending request past its 15 minutes counts as expired, before any sweep writes it down. */
export function statusAt(row: DeviceRequestRow, now: number): OwnerDeviceRequestStatus {
  return row.status === 'pending' && row.expires_at <= now ? 'expired' : row.status;
}

/** The end of the enrolment window, once the request is approved. */
export function enrolUntil(row: DeviceRequestRow): number | null {
  return row.status === 'approved' && row.decided_at !== null
    ? row.decided_at + ENROL_WINDOW_MS
    : null;
}

/** True while the token may still create a passkey: approved, unused, inside the 10 minutes. */
export function enrolOpen(row: DeviceRequestRow, now: number): boolean {
  const until = enrolUntil(row);
  return row.used_at === null && until !== null && until > now;
}

/** What the new device sees: an approved request whose window ran out unused is expired too. */
export function requestState(row: DeviceRequestRow, now: number): OwnerDeviceRequestState {
  const until = enrolUntil(row);
  const status: OwnerDeviceRequestStatus =
    row.status === 'approved' && row.used_at === null && until !== null && until <= now
      ? 'expired'
      : statusAt(row, now);
  return { id: row.id, status, expiresAt: row.expires_at, enrolUntil: until };
}

/** The approval card. */
export function requestView(row: DeviceRequestRow, now: number): OwnerDeviceRequestView {
  return {
    id: row.id,
    code: row.code,
    deviceName: row.device_name,
    platform: row.platform,
    city: row.city,
    status: statusAt(row, now),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

/** RATE_LIMITED when this IP (or the whole salon) asked to add too many devices lately. */
export async function assertRequestBudget(ctx: Ctx): Promise<void> {
  const retry = { 'Retry-After': String(REQUESTS_PER_IP.windowMs / 1000) };
  if (ctx.ipHmac) {
    const byIp = await ctx.db.first<{ n: number }>(
      'SELECT COUNT(*) AS n FROM owner_device_requests WHERE org_id = ?org AND ip_hmac = ? AND created_at > ?',
      ctx.ipHmac,
      ctx.now() - REQUESTS_PER_IP.windowMs,
    );
    if ((byIp?.n ?? 0) >= REQUESTS_PER_IP.max) fail('RATE_LIMITED', undefined, undefined, retry);
  }
  const byOrg = await ctx.db.first<{ n: number }>(
    'SELECT COUNT(*) AS n FROM owner_device_requests WHERE org_id = ?org AND created_at > ?',
    ctx.now() - REQUESTS_PER_ORG.windowMs,
  );
  if ((byOrg?.n ?? 0) >= REQUESTS_PER_ORG.max) fail('RATE_LIMITED', undefined, undefined, retry);
}

export interface Confirmed {
  /** The passkey of this session, which made the answer. */
  own: PasskeyRow;
  /** Its new counter, and last used now: batch this with the action and its audit row. */
  touch: D1PreparedStatement;
}

/**
 * The fingerprint that approve and remove need: a `confirm` challenge issued to this session, answered
 * by this session's own passkey (any other credential, removed or not, is refused). Needs a passkey
 * session of an owner. Uses the challenge up.
 */
export async function confirmOnThisDevice(
  ctx: Ctx,
  rp: RelyingParty,
  challengeId: string,
  credential: PasskeyAssertion,
): Promise<Confirmed> {
  const session = ctx.session;
  const user = ctx.user;
  if (!session || !user) fail('UNAUTHENTICATED');
  if (user.role !== 'owner') fail('FORBIDDEN');
  if (!session.passkeyId)
    fail('FORBIDDEN', 'Sign in with your fingerprint first.', { reason: 'passkey_session' });
  const challenge = await claimChallenge(ctx, challengeId, 'confirm');
  if (
    challenge.user_id !== user.id ||
    challenge.session_hash !== session.tokenHash ||
    challenge.passkey_id !== session.passkeyId
  )
    fail('NONCE_INVALID', CHALLENGE_GONE);
  const own = await ctx.db.first<PasskeyRow>(
    `SELECT ${PASSKEY_COLUMNS} FROM owner_passkeys
      WHERE org_id = ?org AND id = ? AND user_id = ? AND removed_at IS NULL`,
    session.passkeyId,
    user.id,
  );
  if (!own) fail('UNAUTHENTICATED');
  if (credential.id !== own.credential_id) rejectPasskey(ctx, 'confirm', 'other_credential');
  const counter = await verifyAssertion(ctx, rp, 'confirm', challenge.challenge, credential, own);
  const touch = ctx.db.stmt(
    `UPDATE owner_passkeys SET sign_count = MAX(sign_count, ?), last_used_at = ?
      WHERE org_id = ?org AND id = ?`,
    counter,
    ctx.now(),
    own.id,
  );
  return { own, touch };
}
