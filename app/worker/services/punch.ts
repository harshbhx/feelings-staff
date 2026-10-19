/**
 * Punches (PRD 4.3-4.5, 8.2 `punches`, 13.2): row types, view mappers and the check-in pipeline.
 * Owner: WP-4.
 */
import {
  canonicalJson,
  type DayOverride,
  type DaySummary,
  type DistanceBucket,
  type FenceResult,
  type Fix,
  fromBase64Url,
  HOUR_MS,
  istDate,
  istTime,
  type NotifyEvent,
  type OwnerPunchView,
  type PendingReason,
  type PunchKind,
  type PunchOutcome,
  type PunchRequest,
  type PunchResult,
  type PunchSource,
  type PunchStatus,
  type PunchView,
  punchSigningPayload,
  type RiskReason,
} from '@fs/contracts';
import { bestFence, distanceBucket, RISK_POINTS, riskScore } from '@fs/engine';
import type { Context } from 'hono';
import { json } from '../db';
import type { AppEnv } from '../lib/app-env';
import {
  hashPin,
  randomToken,
  sha256Hex,
  signTime,
  timingSafeEqual,
  verifyDeviceSignature,
  verifyTime,
} from '../lib/crypto';
import { fail } from '../lib/errors';
import { loadOrg } from '../lib/settings';
import { ulid } from '../lib/ulid';
import { rateLimitsActive } from '../middleware/guard';
import {
  type Computed,
  type DayData,
  daySummary,
  isPlanningDayService,
  leaveOnDay,
  loadDayData,
  planDay,
  scheduleFrom,
  summaryFromComputed,
} from './day';
import { checkDoorToken, DOOR_TOKEN_MESSAGES, isSalonNetwork, type SiteRow } from './door';
import { activeDutiesFor, type DutyRow, inWorkDateWindow } from './duty';
import { leaveDayCancelStmts } from './leave';
import type { Ctx } from './ports';

export interface PunchRow {
  id: string;
  org_id: string;
  user_id: string;
  device_id: string | null;
  kind: PunchKind;
  server_ts: number;
  effective_ts: number;
  client_ts: number | null;
  work_date: string;
  source: PunchSource;
  site_id: string | null;
  offsite_duty_id: string | null;
  place_name: string | null;
  lat: number | null;
  lng: number | null;
  accuracy_m: number | null;
  distance_m: number | null;
  distance_bucket: DistanceBucket | null;
  fence_result: FenceResult | null;
  samples_n: number | null;
  samples_spread_m: number | null;
  qr_step: number | null;
  pin_verified: number;
  sig_verified: number;
  selfie_key: string | null;
  selfie_sha256: string | null;
  selfie_deleted_at: number | null;
  risk_score: number;
  risk_reasons_json: string;
  status: PunchStatus;
  pending_reason: PendingReason | null;
  ip_country: string | null;
  ip_asn: number | null;
  device_tz: string | null;
  clock_skew_ms: number | null;
  app_version: string | null;
  client_duration_ms: number | null;
  idempotency_key: string;
  note: string | null;
  reviewed_by: string | null;
  reviewed_at: number | null;
  review_note: string | null;
  replaces_punch_id: string | null;
  created_at: number;
}

/** Statuses that count for pay (PRD 4.4.4: a flag alone never changes pay). */
export const COUNTED_STATUSES: readonly PunchStatus[] = ['accepted', 'flagged'];

export const isCounted = (p: Pick<PunchRow, 'status'>): boolean =>
  COUNTED_STATUSES.includes(p.status);

export function riskReasonsOf(row: Pick<PunchRow, 'risk_reasons_json'>): RiskReason[] {
  return json<RiskReason[]>(row.risk_reasons_json, []);
}

/** "Edited by Urmi": created or replaced by the owner. */
export const isEdited = (row: Pick<PunchRow, 'source' | 'replaces_punch_id'>): boolean =>
  row.source === 'owner' || row.replaces_punch_id !== null;

export function punchView(row: PunchRow, siteName: string | null): PunchView {
  return {
    id: row.id,
    kind: row.kind,
    effectiveTs: row.effective_ts,
    serverTs: row.server_ts,
    workDate: row.work_date,
    source: row.source,
    status: row.status,
    pendingReason: row.pending_reason,
    siteName,
    placeName: row.place_name,
    fenceResult: row.fence_result,
    distanceBucket: row.distance_bucket,
    riskReasons: riskReasonsOf(row),
    offsiteDutyId: row.offsite_duty_id,
    edited: isEdited(row),
    note: row.note,
    reviewNote: row.review_note,
  };
}

/** Owner-facing selfie URL (session-checked route), or null when there is none any more. */
export function selfieUrl(row: Pick<PunchRow, 'id' | 'selfie_key' | 'selfie_deleted_at'>) {
  return row.selfie_key && row.selfie_deleted_at === null
    ? `/api/v1/owner/punches/${row.id}/selfie`
    : null;
}

export function ownerPunchView(
  row: PunchRow,
  names: { siteName: string | null; deviceLabel: string | null; reviewedByName: string | null },
): OwnerPunchView {
  return {
    ...punchView(row, names.siteName),
    lat: row.lat,
    lng: row.lng,
    accuracyM: row.accuracy_m,
    distanceM: row.distance_m,
    samplesN: row.samples_n,
    riskScore: row.risk_score,
    qrVerified: row.qr_step !== null,
    pinVerified: row.pin_verified === 1,
    sigVerified: row.sig_verified === 1,
    selfieUrl: selfieUrl(row),
    selfieDeletedAt: row.selfie_deleted_at,
    deviceLabel: names.deviceLabel,
    ipCountry: row.ip_country,
    clientTs: row.client_ts,
    reviewedByName: names.reviewedByName,
    reviewedAt: row.reviewed_at,
  };
}

// ---- Pipeline ------------------------------------------------------------------------------------

export const SELFIE_MAX_BYTES = 200 * 1024;
export const PROOF_WINDOW_MS = 10 * 60_000;
export const PUNCH_NONCE_TTL_MS = 5 * 60_000;
export const OFFLINE_NONCE_TTL_MS = 24 * HOUR_MS;
/** Unused offline nonces still work this long after their nominal expiry (queued punches). */
export const OFFLINE_NONCE_GRACE_MS = 6 * 24 * HOUR_MS;
/** An `in` older than this no longer absorbs punches (auto-close territory, PRD 7.2). */
export const OPEN_SESSION_MS = 20 * HOUR_MS;
export const OFFLINE_ACCEPT_SYNC_MS = 12 * HOUR_MS;
export const OFFLINE_MAX_WINDOW_MS = 2 * HOUR_MS;
export const REPLAY_WINDOW_MS = 14 * 24 * HOUR_MS;
export const JUMP_LOOKBACK_MS = 12 * HOUR_MS;
const PIN_MAX_TRIES = 5;
const PIN_LOCK_MS = 15 * 60_000;
const PIN_ALERT_24H = 10;

interface DeviceRow {
  id: string;
  user_id: string;
  public_jwk: string;
  status: 'pending' | 'approved' | 'rejected' | 'revoked';
  approved_at: number | null;
  label: string;
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Who is the owner called in staff copy ("Urmi"). */
async function ownerName(ctx: Ctx): Promise<string> {
  return (await loadOrg(ctx)).org.owner_display_name;
}

// ---- PIN (PRD 9.3: 5 wrong -> 15 min lock; 10 wrong in 24 h -> owner alert N21) -------------------

interface PinRow {
  name: string;
  pin_hash: string | null;
  pin_salt: string | null;
  pin_failures: number;
  pin_failures_24h: number;
  pin_window_start: number | null;
  pin_locked_until: number | null;
}

/**
 * Check a staff PIN with the shared lockout rules (same columns and limits as WP-3's sign-in).
 * Throws PIN_LOCKED / PIN_WRONG; resets the consecutive count on success.
 */
export async function verifyUserPin(ctx: Ctx, userId: string, pin: string): Promise<void> {
  const u = await ctx.db.first<PinRow>(
    `SELECT name, pin_hash, pin_salt, pin_failures, pin_failures_24h, pin_window_start, pin_locked_until
       FROM users WHERE org_id = ?org AND id = ?`,
    userId,
  );
  if (!u) return fail('UNAUTHENTICATED');
  const now = ctx.now();
  if (u.pin_locked_until !== null && u.pin_locked_until > now) {
    fail('PIN_LOCKED', `Too many wrong tries. Try again at ${istTime(u.pin_locked_until)}.`, {
      until: u.pin_locked_until,
    });
  }
  const ok =
    u.pin_hash !== null &&
    u.pin_salt !== null &&
    timingSafeEqual(await hashPin(ctx.env.PIN_PEPPER, u.pin_salt, pin), u.pin_hash);
  if (ok) {
    if (u.pin_failures > 0) {
      await ctx.db.run('UPDATE users SET pin_failures = 0 WHERE org_id = ?org AND id = ?', userId);
    }
    return;
  }
  const sameWindow = u.pin_window_start !== null && now - u.pin_window_start < 24 * HOUR_MS;
  const windowStart = sameWindow ? (u.pin_window_start as number) : now;
  const failures24h = (sameWindow ? u.pin_failures_24h : 0) + 1;
  const failures = u.pin_failures + 1;
  const lockUntil = failures >= PIN_MAX_TRIES ? now + PIN_LOCK_MS : null;
  await ctx.db.batch([
    ctx.db.update(
      'users',
      {
        pin_failures: lockUntil ? 0 : failures,
        pin_failures_24h: failures24h,
        pin_window_start: windowStart,
        pin_locked_until: lockUntil,
      },
      'id = ?',
      userId,
    ),
    ctx.services.audit.stmt(ctx, {
      category: 'security',
      action: lockUntil ? 'pin.locked' : 'pin.wrong',
      entity: 'user',
      entityId: userId,
      after: { context: 'punch', failures24h },
    }),
  ]);
  if (failures24h === PIN_ALERT_24H) {
    await safeEmit(ctx, {
      type: 'pin_attempts',
      orgId: ctx.orgId as string,
      at: now,
      userId,
      name: u.name,
      count: failures24h,
    });
  }
  if (lockUntil) {
    fail('PIN_LOCKED', `Too many wrong tries. Try again at ${istTime(lockUntil)}.`, {
      until: lockUntil,
    });
  }
  const left = PIN_MAX_TRIES - failures;
  fail('PIN_WRONG', `Wrong PIN. ${left} ${left === 1 ? 'try' : 'tries'} left.`, {
    triesLeft: left,
  });
}

/** Open the offline PIN envelope: RSA-OAEP-256 sealed `{ pin, idempotencyKey }` (PRD 10.3). */
export async function openPinEnvelope(
  privateJwk: string,
  envelope: string,
): Promise<{ pin: string; idempotencyKey: string } | null> {
  try {
    const jwk = JSON.parse(privateJwk) as JsonWebKey;
    const key = await crypto.subtle.importKey(
      'jwk',
      { ...jwk, key_ops: ['decrypt'], alg: 'RSA-OAEP-256' },
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['decrypt'],
    );
    const plain = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, key, fromBase64Url(envelope));
    const parsed = JSON.parse(new TextDecoder().decode(plain)) as Record<string, unknown>;
    if (typeof parsed.pin !== 'string' || typeof parsed.idempotencyKey !== 'string') return null;
    return { pin: parsed.pin, idempotencyKey: parsed.idempotencyKey };
  } catch {
    return null;
  }
}

/** Emit without letting a notifier failure break the request. */
export async function safeEmit(ctx: Ctx, e: NotifyEvent): Promise<void> {
  try {
    await ctx.services.notifier.emit(ctx, e);
  } catch (err) {
    console.error(
      JSON.stringify({
        msg: 'notify.emit_failed',
        type: e.type,
        requestId: ctx.requestId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

// ---- Nonces -----------------------------------------------------------------------------------------

/** The approved device the session belongs to (staff), or the person's approved device. */
async function sessionDeviceId(ctx: Ctx, userId: string): Promise<string> {
  if (ctx.session?.deviceId) return ctx.session.deviceId;
  const d = await ctx.db.first<{ id: string }>(
    "SELECT id FROM devices WHERE org_id = ?org AND user_id = ? AND status = 'approved'",
    userId,
  );
  return d?.id ?? '';
}

export async function issueNonces(ctx: Ctx, purpose: 'punch' | 'offline') {
  const user = ctx.user ?? fail('UNAUTHENTICATED');
  const now = ctx.now();
  const deviceId = await sessionDeviceId(ctx, user.id);
  const timeSig = await signTime(ctx.env.TIME_SIGNING_KEY, now, deviceId);
  const ttl = purpose === 'punch' ? PUNCH_NONCE_TTL_MS : OFFLINE_NONCE_TTL_MS;
  const nonces = Array.from({ length: purpose === 'punch' ? 1 : 2 }, () => ({
    nonce: randomToken(32),
    expiresAt: now + ttl,
  }));
  await ctx.db.batch(
    nonces.map((n) =>
      ctx.db.insert('challenges', {
        nonce: n.nonce,
        purpose,
        user_id: user.id,
        device_id: deviceId || null,
        expires_at: n.expiresAt,
      }),
    ),
  );
  if (purpose === 'punch') {
    const n = nonces[0] as { nonce: string; expiresAt: number };
    return { nonce: n.nonce, expiresAt: n.expiresAt, serverTime: now, timeSig };
  }
  return { nonces, serverTime: now, timeSig };
}

// ---- Shared lookups ---------------------------------------------------------------------------------

/** The last in/out/break punch that is still part of a session (within 20 h). */
async function lastSessionPunch(ctx: Ctx, userId: string, beforeTs: number) {
  return ctx.db.first<PunchRow>(
    `SELECT * FROM punches
      WHERE org_id = ?org AND user_id = ? AND status IN ('accepted', 'flagged', 'pending')
        AND effective_ts >= ? AND effective_ts <= ?
      ORDER BY effective_ts DESC, id DESC LIMIT 1`,
    userId,
    beforeTs - OPEN_SESSION_MS,
    beforeTs,
  );
}

export type SessionState = 'out' | 'in' | 'on_break';

export function sessionState(last: Pick<PunchRow, 'kind'> | null): SessionState {
  if (!last || last.kind === 'out') return 'out';
  return last.kind === 'break_start' ? 'on_break' : 'in';
}

async function siteNames(ctx: Ctx, ids: readonly (string | null)[]): Promise<Map<string, string>> {
  const list = [...new Set(ids.filter((x): x is string => x !== null))];
  if (list.length === 0) return new Map();
  const rows = await ctx.db.all<{ id: string; name: string }>(
    'SELECT id, name FROM sites WHERE org_id = ?org AND id IN (SELECT value FROM json_each(?))',
    JSON.stringify(list),
  );
  return new Map(rows.map((r) => [r.id, r.name]));
}

export async function punchViews(ctx: Ctx, rows: readonly PunchRow[]): Promise<PunchView[]> {
  const names = await siteNames(
    ctx,
    rows.map((r) => r.site_id),
  );
  return rows.map((r) => punchView(r, r.site_id ? (names.get(r.site_id) ?? null) : null));
}

/** Owner views with site names, device labels and reviewer names (PRD 4.12, 5.2 day detail). */
export async function ownerPunchViews(
  ctx: Ctx,
  rows: readonly PunchRow[],
): Promise<OwnerPunchView[]> {
  const names = await siteNames(
    ctx,
    rows.map((r) => r.site_id),
  );
  const deviceIds = [...new Set(rows.map((r) => r.device_id).filter((x): x is string => !!x))];
  const reviewerIds = [...new Set(rows.map((r) => r.reviewed_by).filter((x): x is string => !!x))];
  const [devices, reviewers] = await Promise.all([
    deviceIds.length
      ? ctx.db.all<{ id: string; label: string }>(
          'SELECT id, label FROM devices WHERE org_id = ?org AND id IN (SELECT value FROM json_each(?))',
          JSON.stringify(deviceIds),
        )
      : Promise.resolve([]),
    reviewerIds.length
      ? ctx.db.all<{ id: string; name: string }>(
          'SELECT id, name FROM users WHERE org_id = ?org AND id IN (SELECT value FROM json_each(?))',
          JSON.stringify(reviewerIds),
        )
      : Promise.resolve([]),
  ]);
  const dev = new Map(devices.map((d) => [d.id, d.label]));
  const rev = new Map(reviewers.map((u) => [u.id, u.name]));
  return rows.map((r) =>
    ownerPunchView(r, {
      siteName: r.site_id ? (names.get(r.site_id) ?? null) : null,
      deviceLabel: r.device_id ? (dev.get(r.device_id) ?? null) : null,
      reviewedByName: r.reviewed_by ? (rev.get(r.reviewed_by) ?? null) : null,
    }),
  );
}

export async function punchById(ctx: Ctx, id: string): Promise<PunchRow | null> {
  return ctx.db.first<PunchRow>('SELECT * FROM punches WHERE org_id = ?org AND id = ?', id);
}

/** What the staff member is told for a stored punch (PRD 4.4.4). */
export function outcomeOf(row: PunchRow, now: number): PunchOutcome {
  if (row.status === 'flagged') return 'flagged';
  if (row.status !== 'pending') return 'accepted';
  const proof =
    (row.pending_reason === 'needs_proof' || row.pending_reason === 'strong_mode') &&
    row.note === null &&
    now <= row.server_ts + PROOF_WINDOW_MS;
  return proof ? 'needs_proof' : 'pending';
}

export function proofUntil(row: PunchRow, now: number): number | null {
  return outcomeOf(row, now) === 'needs_proof' ? row.server_ts + PROOF_WINDOW_MS : null;
}

/** "Stayed 37 min after your shift" when 30 min or more past the scheduled end (PRD 4.3.1). */
function stayedAfter(row: PunchRow, shiftEndTs: number | null): number | null {
  if (row.kind !== 'out' || shiftEndTs === null) return null;
  const min = Math.floor((row.effective_ts - shiftEndTs) / 60_000);
  return min >= 30 ? min : null;
}

/** PunchResult for a stored punch; `computed` when the caller just planned the day. */
export async function punchResult(
  ctx: Ctx,
  row: PunchRow,
  computed?: { data: DayData; c: Computed },
): Promise<PunchResult> {
  let day: DaySummary | null;
  let shiftEnd: number | null;
  if (computed) {
    day = summaryFromComputed(computed.data, computed.c);
    shiftEnd = computed.c.schedule.segments.at(-1)?.endTs ?? null;
  } else {
    const data = await loadDayData(ctx, [row.user_id], row.work_date, row.work_date);
    day = daySummary(data, row.user_id, row.work_date);
    shiftEnd = scheduleFrom(data, row.user_id, row.work_date)?.segments.at(-1)?.endTs ?? null;
  }
  if (!day) return fail('NOT_FOUND');
  const [view] = await punchViews(ctx, [row]);
  const now = ctx.now();
  return {
    punch: view as PunchView,
    outcome: outcomeOf(row, now),
    riskReasons: riskReasonsOf(row),
    fence: {
      result: row.fence_result ?? 'none',
      distanceM: row.distance_m,
      bucket: row.distance_bucket,
    },
    day,
    stayedAfterMin: stayedAfter(row, shiftEnd),
    proofUntil: proofUntil(row, now),
  };
}

// ---- POST /punches (PRD 13.2) ------------------------------------------------------------------------

function denyDevice(
  ctx: Ctx,
  reason: 'unknown' | 'other_user' | 'pending' | 'rejected' | 'revoked' | 'signature',
  deviceId: string,
  owner: string,
): Promise<never> {
  const messages: Record<typeof reason, string> = {
    unknown: `This phone isn't registered. Ask ${owner}.`,
    other_user: `This phone belongs to someone else. Ask ${owner}.`,
    pending: `${owner} hasn't approved this phone yet.`,
    rejected: `${owner} didn't approve this phone. Ask ${owner}.`,
    revoked: `This phone was removed. Ask ${owner}.`,
    signature: `This phone's security key didn't match. Ask ${owner}.`,
  };
  return ctx.services.audit
    .log(ctx, {
      category: 'security',
      action: 'punch.denied',
      entity: 'device',
      entityId: deviceId,
      after: { reason },
    })
    .then(() => fail('DEVICE_NOT_APPROVED', messages[reason], { reason }));
}

/** Most specific first: this is the reason the owner sees (PRD 4.4.2, 4.3.2, 4.3.6, 4.6). */
const PENDING_ORDER: readonly PendingReason[] = [
  'late_sync',
  'offline_window',
  'offsite_unplanned',
  'duty_approval',
  'outside_fence',
  'too_early',
  'consent_withdrawn',
  'selfie_missing',
  'strong_mode',
  'needs_proof',
];

interface FenceOutcome {
  result: FenceResult;
  distanceM: number | null;
  site: SiteRow | null;
  duty: DutyRow | null;
  offsitePass: boolean;
}

function siteGeo(s: SiteRow) {
  return { id: s.id, lat: s.lat, lng: s.lng, radiusM: s.radius_m, maxAccuracyM: s.max_accuracy_m };
}

/** Fence against the salon and the venue of an active duty; PASS on either is enough (PRD 4.4.1). */
async function fenceFor(
  ctx: Ctx,
  fix: Fix | null,
  duties: readonly DutyRow[],
  preferredDutyId: string | null,
): Promise<FenceOutcome> {
  const duty =
    duties.find((d) => d.id === preferredDutyId) ??
    duties.find((d) => d.mode !== 'geofence') ??
    duties[0] ??
    null;
  if (duty && duty.mode !== 'geofence') {
    // "Anywhere" records the location without a fence; "Needs my approval" makes every punch
    // pending (PRD 4.6 A step 4). Neither blocks on location.
    return { result: 'none', distanceM: null, site: null, duty, offsitePass: true };
  }
  if (!fix) return { result: 'none', distanceM: null, site: null, duty, offsitePass: false };
  const sites = await ctx.db.all<SiteRow>(
    `SELECT * FROM sites WHERE org_id = ?org AND active = 1
       AND (kind = 'salon' OR id IN (SELECT value FROM json_each(?)))`,
    JSON.stringify(duties.map((d) => d.site_id).filter(Boolean)),
  );
  const best = bestFence(
    fix,
    sites.map((s) => ({ ...siteGeo(s), row: s })),
  );
  if (!best) return { result: 'none', distanceM: null, site: null, duty, offsitePass: false };
  const venue = best.site.row.kind === 'venue';
  const venueDuty = venue ? (duties.find((d) => d.site_id === best.site.id) ?? duty) : duty;
  return {
    result: best.check.result,
    distanceM: Math.round(best.check.distanceM),
    site: best.site.row,
    duty: venue ? venueDuty : duty,
    offsitePass: venue && best.check.result === 'pass',
  };
}

export async function createPunch(
  ctx: Ctx,
  c: Context<AppEnv>,
  body: PunchRequest,
  files: Record<string, File>,
): Promise<PunchResult> {
  const user = ctx.user ?? fail('UNAUTHENTICATED');
  const orgId = ctx.orgId as string;
  const now = ctx.now();

  // Rate limit (RL_PUNCH, 6 / 60 s per person).
  if (ctx.env.RL_PUNCH && rateLimitsActive(c)) {
    const { success } = await ctx.env.RL_PUNCH.limit({ key: user.id });
    if (!success) fail('RATE_LIMITED', undefined, undefined, { 'Retry-After': '60' });
  }

  const { org, settings } = await loadOrg(ctx);
  const owner = org.owner_display_name;

  // Device approved, bound to this person, signature valid (PRD 4.4.2).
  const device = await ctx.db.first<DeviceRow>(
    'SELECT id, user_id, public_jwk, status, approved_at, label FROM devices WHERE org_id = ?org AND id = ?',
    body.deviceId,
  );
  if (!device) return denyDevice(ctx, 'unknown', body.deviceId, owner);
  if (device.user_id !== user.id) return denyDevice(ctx, 'other_user', body.deviceId, owner);
  if (device.status !== 'approved') return denyDevice(ctx, device.status, body.deviceId, owner);
  const sigOk = await verifyDeviceSignature(
    json(device.public_jwk, {} as JsonWebKey),
    punchSigningPayload(body),
    body.signature,
  );
  if (!sigOk) return denyDevice(ctx, 'signature', body.deviceId, owner);

  // A repeat of a punch we already stored returns the first result (S-04.3).
  const existing = await ctx.db.first<PunchRow>(
    'SELECT * FROM punches WHERE org_id = ?org AND user_id = ? AND idempotency_key = ?',
    user.id,
    body.idempotencyKey,
  );
  if (existing) return punchResult(ctx, existing);

  // Single-use nonce.
  const purpose = body.offline ? 'offline' : 'punch';
  const used = await ctx.db.run(
    `UPDATE challenges SET used_at = ?
      WHERE org_id = ?org AND nonce = ? AND purpose = ? AND used_at IS NULL AND user_id = ?
        AND (device_id IS NULL OR device_id = ?) AND expires_at > ?`,
    now,
    body.nonce,
    purpose,
    user.id,
    device.id,
    purpose === 'offline' ? now - OFFLINE_NONCE_GRACE_MS : now,
  );
  if (used.meta.changes !== 1) fail('NONCE_INVALID');

  const isBreak = body.kind === 'break_start' || body.kind === 'break_end';
  if (isBreak && !settings.attendance.breakPunches) {
    fail('RULE_VIOLATION', 'Break punches are off at this salon.', { reason: 'breaks_off' });
  }

  // PIN, or the sealed PIN of an offline punch.
  let pinVerified = false;
  if (!isBreak) {
    if (body.offline) {
      const env = await openPinEnvelope(ctx.env.PUNCH_ENC_PRIVATE_JWK, body.offline.pinEnvelope);
      if (!env || env.idempotencyKey !== body.idempotencyKey) {
        fail('BAD_REQUEST', "We couldn't read the saved PIN. Check in again.", {
          reason: 'envelope',
        });
      }
      await verifyUserPin(ctx, user.id, env.pin);
      pinVerified = true;
    } else if (body.pin !== null) {
      await verifyUserPin(ctx, user.id, body.pin);
      pinVerified = true;
    } else if (settings.attendance.pinEveryPunch) {
      fail('PIN_WRONG', 'Enter your PIN.', { triesLeft: null, reason: 'missing' });
    }
  }

  // Time: server time of this first submission, or the bounded event time of an offline punch.
  let effectiveTs = now;
  let clockSkewMs = body.clientTs - now;
  let offlinePending: PendingReason | null = null;
  if (body.offline) {
    const o = body.offline;
    const anchored =
      o.lastServerTime <= now &&
      (await verifyTime(ctx.env.TIME_SIGNING_KEY, o.lastServerTime, body.deviceId, o.timeSig));
    if (anchored) {
      const delta = Math.max(0, o.perfDeltaMs >= 0 ? o.perfDeltaMs : o.wallDeltaMs);
      effectiveTs = Math.min(now, o.lastServerTime + delta);
      if (
        effectiveTs - o.lastServerTime > OFFLINE_MAX_WINDOW_MS ||
        istDate(o.lastServerTime) !== istDate(effectiveTs)
      ) {
        offlinePending = 'offline_window';
      }
    } else {
      effectiveTs = Math.min(now, Math.max(body.clientTs, now - OFFLINE_NONCE_GRACE_MS));
      offlinePending = 'offline_window';
    }
    if (now - effectiveTs > OFFLINE_ACCEPT_SYNC_MS) offlinePending = 'late_sync';
    clockSkewMs = body.clientTs - effectiveTs;
  }

  // Session state and work date (PRD 7.2).
  const last = await lastSessionPunch(ctx, user.id, effectiveTs);
  const state = sessionState(last);
  const duties = await activeDutiesFor(ctx, user.id, effectiveTs);
  let workDate: string;
  if (body.kind === 'in') {
    if (state !== 'out') fail('CONFLICT', "You're already checked in.", { reason: 'already_in' });
    workDate =
      duties.find((d) => inWorkDateWindow(d, effectiveTs))?.work_date ?? istDate(effectiveTs);
  } else {
    const need = body.kind === 'break_end' ? 'on_break' : 'in';
    if (state === 'out' || (body.kind !== 'out' && state !== need)) {
      fail('CONFLICT', "You're not checked in.", { reason: 'not_checked_in' });
    }
    workDate = (last as PunchRow).work_date;
  }

  const data = await loadDayData(ctx, [user.id], workDate, workDate, settings);
  const profile = data.people.get(user.id);
  if (!profile) {
    return fail('RULE_VIOLATION', `Your profile isn't set up yet. Ask ${owner}.`, {
      reason: 'no_profile',
    });
  }
  const schedule = scheduleFrom(data, user.id, workDate);
  const leave = leaveOnDay(data, user.id, workDate);

  // When check-in is allowed (PRD 4.3.2).
  let tooEarly = false;
  if (body.kind === 'in' && schedule) {
    if (schedule.dayType === 'NE') {
      fail('RULE_VIOLATION', 'You are not on the staff list for this date.', {
        reason: 'not_employed',
      });
    }
    if (schedule.dayType === 'WO' && !body.ack.includes('week_off')) {
      fail(
        'RULE_VIOLATION',
        `Today is your week off. Check in anyway? ${owner} will see it as extra work.`,
        {
          need: 'week_off',
        },
      );
    }
    if (schedule.dayType === 'HO' && !body.ack.includes('holiday')) {
      fail(
        'RULE_VIOLATION',
        `Today is a holiday (${schedule.holiday?.name ?? 'salon closed'}). Check in anyway? ${owner} will see it as extra work.`,
        { need: 'holiday' },
      );
    }
    if (leave && !body.ack.includes('on_leave')) {
      fail('RULE_VIOLATION', "You're on leave today. Checking in will cancel today's leave.", {
        need: 'on_leave',
      });
    }
    const start = schedule.dayType === 'work' ? schedule.segments[0] : undefined;
    if (start) {
      const earliest = start.startTs - settings.attendance.earliestCheckInMin * 60_000;
      if (effectiveTs < earliest) {
        const covered =
          duties.some((d) => inWorkDateWindow(d, effectiveTs)) ||
          (data.preapprovals.get(user.id) ?? []).some(
            (p) => p.start_ts <= effectiveTs && effectiveTs <= p.end_ts,
          );
        if (!covered) {
          if (!body.ack.includes('too_early')) {
            fail(
              'TOO_EARLY',
              `Your shift starts at ${istTime(start.startTs)}. You can check in from ${istTime(earliest)}.`,
              { earliestTs: earliest, shiftStartTs: start.startTs },
            );
          }
          tooEarly = true;
        }
      }
    }
  }

  // Selfie (PRD 4.3.4, 10.4, S-07.3).
  const personSelfie =
    profile.selfie_required === null
      ? settings.attendance.selfieOnCheckIn
      : profile.selfie_required === 1;
  const selfieNeeded =
    body.kind === 'in'
      ? personSelfie
      : body.kind === 'out' && personSelfie && settings.attendance.selfieOnCheckOut;
  const selfie = files.selfie ?? null;
  let selfieBytes: Uint8Array<ArrayBuffer> | null = null;
  if (selfie) {
    if (selfie.size > SELFIE_MAX_BYTES) fail('PAYLOAD_TOO_LARGE');
    selfieBytes = new Uint8Array(await selfie.arrayBuffer());
    if (!body.selfieSha256 || (await sha256Hex(selfieBytes)) !== body.selfieSha256) {
      fail('BAD_REQUEST', "The photo didn't match. Take it again.", { reason: 'selfie_hash' });
    }
  } else if (body.selfieSha256) {
    fail('BAD_REQUEST', 'The photo is missing. Take it again.', { reason: 'selfie_hash' });
  }
  let consentWithdrawn = false;
  if (selfieNeeded) {
    const consent = await ctx.db.first<{ withdrawn_at: number | null }>(
      `SELECT withdrawn_at FROM consents WHERE org_id = ?org AND user_id = ? AND kind = 'selfie'
        ORDER BY accepted_at DESC LIMIT 1`,
      user.id,
    );
    consentWithdrawn = consent?.withdrawn_at != null;
  }
  const storeSelfie = selfieNeeded && selfieBytes !== null && !consentWithdrawn;

  // Location, door QR, risk (PRD 4.4).
  const fence: FenceOutcome = isBreak
    ? { result: 'none', distanceM: null, site: null, duty: null, offsitePass: false }
    : await fenceFor(ctx, body.fix, duties, body.offsiteDutyId);
  let qr: { siteId: string; step: number } | null = null;
  if (body.qrToken && !isBreak) {
    const check = await checkDoorToken(ctx, body.qrToken, effectiveTs);
    if (!check.ok)
      fail('RULE_VIOLATION', DOOR_TOKEN_MESSAGES[check.reason], { reason: check.reason });
    const reused = await ctx.db.first<{ id: string }>(
      'SELECT id FROM punches WHERE org_id = ?org AND user_id = ? AND qr_step = ?',
      user.id,
      check.step,
    );
    if (reused) fail('RULE_VIOLATION', DOOR_TOKEN_MESSAGES.qr_reused, { reason: 'qr_reused' });
    qr = { siteId: check.siteId, step: check.step };
  }

  let riskReasons: RiskReason[] = [];
  let riskScoreValue = 0;
  let riskOutcome: 'accept' | 'flag' | 'proof' | 'block' = 'accept';
  if (!isBreak) {
    const [recent, previous, salonNet] = await Promise.all([
      ctx.db.all<{ lat: number; lng: number }>(
        `SELECT lat, lng FROM punches WHERE org_id = ?org AND user_id = ? AND lat IS NOT NULL
           AND server_ts >= ? ORDER BY server_ts DESC LIMIT 200`,
        user.id,
        now - REPLAY_WINDOW_MS,
      ),
      ctx.db.first<{ lat: number; lng: number; effective_ts: number }>(
        `SELECT lat, lng, effective_ts FROM punches WHERE org_id = ?org AND user_id = ? AND lat IS NOT NULL
           AND effective_ts BETWEEN ? AND ? ORDER BY effective_ts DESC LIMIT 1`,
        user.id,
        effectiveTs - JUMP_LOOKBACK_MS,
        effectiveTs + JUMP_LOOKBACK_MS,
      ),
      isSalonNetwork(ctx, now),
    ]);
    const risk = riskScore({
      fence: fence.result,
      fix: body.fix,
      recentFixes: recent,
      previousFix: previous
        ? { lat: previous.lat, lng: previous.lng, ts: previous.effective_ts }
        : null,
      nowTs: effectiveTs,
      ipCountry: (ctx.cf?.country as string | undefined) ?? null,
      ipAsn: typeof ctx.cf?.asn === 'number' ? ctx.cf.asn : null,
      deviceTz: body.deviceTz || null,
      clockSkewMs,
      deviceApprovedAt: device.approved_at,
      offline: body.offline !== null,
      salonNetworkMatch: salonNet,
      doorQrValid: qr !== null,
      offsitePass: fence.offsitePass,
      flagAt: settings.risk.flagAt,
      proofAt: settings.risk.proofAt,
    });
    riskReasons = risk.reasons;
    riskScoreValue = risk.score;
    riskOutcome = risk.outcome;
  }

  // Outcome (PRD 4.4.2, 4.4.4).
  const reasons = new Set<PendingReason>();
  if (offlinePending) reasons.add(offlinePending);
  if (riskOutcome === 'block') {
    if (body.requestApproval && body.placeName) reasons.add('offsite_unplanned');
    else if (body.requestApproval) reasons.add('outside_fence');
    else if (fence.result === 'approximate') {
      fail('LOCATION_APPROXIMATE', 'Your phone is sharing only an approximate location.', {
        accuracyM: body.fix ? Math.round(body.fix.accuracy) : null,
      });
    } else {
      const siteName = fence.duty?.place_name ?? fence.site?.name ?? org.name;
      fail(
        'OUTSIDE_FENCE',
        fence.distanceM !== null
          ? `You're about ${fence.distanceM} m from ${fence.site?.kind === 'venue' ? siteName : 'the salon'}.`
          : "We couldn't confirm you're at the salon.",
        { distanceM: fence.distanceM, siteName, dutyId: fence.duty?.id ?? null },
      );
    }
  } else if (
    body.requestApproval &&
    body.placeName &&
    !fence.offsitePass &&
    fence.result !== 'pass'
  ) {
    reasons.add('offsite_unplanned');
  }
  if (fence.duty?.mode === 'approval') reasons.add('duty_approval');
  if (tooEarly) reasons.add('too_early');
  if (consentWithdrawn) reasons.add('consent_withdrawn');
  else if (selfieNeeded && !selfieBytes) reasons.add('selfie_missing');
  const strong = profile.strong_mode === 1 || settings.attendance.strongMode;
  if (body.kind === 'in' && strong && !qr) reasons.add('strong_mode');
  if (riskOutcome === 'proof') reasons.add('needs_proof');
  const pendingReason = PENDING_ORDER.find((r) => reasons.has(r)) ?? null;
  const status: PunchStatus = pendingReason
    ? 'pending'
    : riskOutcome === 'flag'
      ? 'flagged'
      : 'accepted';

  // Build the row.
  const punchId = ulid(now);
  const d = istDate(now);
  const selfieKey = storeSelfie
    ? `selfies/${orgId}/${d.slice(0, 4)}/${d.slice(5, 7)}/${d.slice(8, 10)}/${punchId}.jpg`
    : null;
  const sentToOwner = body.requestApproval || reasons.has('offsite_unplanned');
  const row: PunchRow = {
    id: punchId,
    org_id: orgId,
    user_id: user.id,
    device_id: device.id,
    kind: body.kind,
    server_ts: now,
    effective_ts: effectiveTs,
    client_ts: body.clientTs,
    work_date: workDate,
    source: body.offline ? 'offline' : 'online',
    site_id: fence.site?.id ?? qr?.siteId ?? null,
    offsite_duty_id:
      fence.duty &&
      (fence.site?.kind !== 'salon' || fence.result !== 'pass' || fence.duty.mode !== 'geofence')
        ? fence.duty.id
        : null,
    place_name: body.placeName ?? null,
    lat: body.fix && !isBreak ? round6(body.fix.lat) : null,
    lng: body.fix && !isBreak ? round6(body.fix.lng) : null,
    accuracy_m: body.fix && !isBreak ? Math.round(body.fix.accuracy * 10) / 10 : null,
    distance_m: fence.distanceM,
    distance_bucket: fence.distanceM !== null ? distanceBucket(fence.distanceM) : null,
    fence_result: isBreak ? null : fence.result,
    samples_n: body.fix && !isBreak ? body.fix.samples : null,
    samples_spread_m: body.fix && !isBreak ? Math.round(body.fix.spreadM * 10) / 10 : null,
    qr_step: qr?.step ?? null,
    pin_verified: pinVerified ? 1 : 0,
    sig_verified: 1,
    selfie_key: selfieKey,
    selfie_sha256: storeSelfie ? body.selfieSha256 : null,
    selfie_deleted_at: null,
    risk_score: riskScoreValue,
    risk_reasons_json: JSON.stringify(riskReasons),
    status,
    pending_reason: pendingReason,
    ip_country: (ctx.cf?.country as string | undefined) ?? null,
    ip_asn: typeof ctx.cf?.asn === 'number' ? ctx.cf.asn : null,
    device_tz: body.deviceTz || null,
    clock_skew_ms: clockSkewMs,
    app_version: body.appVersion,
    client_duration_ms: body.clientDurationMs,
    idempotency_key: body.idempotencyKey,
    note: sentToOwner ? (body.note ?? '') : (body.note ?? null),
    reviewed_by: null,
    reviewed_at: null,
    review_note: null,
    replaces_punch_id: null,
    created_at: now,
  };

  if (selfieKey && selfieBytes) {
    await ctx.env.MEDIA.put(selfieKey, selfieBytes, {
      httpMetadata: { contentType: 'image/jpeg' },
      customMetadata: { 'x-org-id': orgId, 'x-sha256': body.selfieSha256 ?? '' },
    });
  }

  // One batch: punch, leave cancellation, day, device last seen, audit (PRD 13.2 step 4).
  const stmts: D1PreparedStatement[] = [ctx.db.insert('punches', { ...row, org_id: undefined })];
  if (body.kind === 'in' && leave && body.ack.includes('on_leave')) {
    stmts.push(...(await leaveDayCancelStmts(ctx, data, leave, workDate, user.id)));
  }
  const planning = isPlanningDayService(ctx.services.days);
  const plan = planning
    ? await planDay(ctx, user.id, workDate, { punches: (rows) => [...rows, row] }, data)
    : null;
  if (plan) stmts.push(...plan.stmts);
  stmts.push(
    ctx.db.update('devices', { last_seen_at: now }, 'id = ?', device.id),
    ctx.services.audit.stmt(ctx, {
      category: 'change',
      action: 'punch.create',
      entity: 'punch',
      entityId: punchId,
      after: {
        kind: row.kind,
        status,
        pendingReason,
        effectiveTs,
        workDate,
        riskScore: riskScoreValue,
        source: row.source,
      },
    }),
  );
  try {
    await ctx.db.batch(stmts);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('punches.user_id, punches.idempotency_key') || msg.includes('punches_idem')) {
      const first = await ctx.db.first<PunchRow>(
        'SELECT * FROM punches WHERE org_id = ?org AND user_id = ? AND idempotency_key = ?',
        user.id,
        body.idempotencyKey,
      );
      if (first) return punchResult(ctx, first);
    }
    if (msg.includes('qr_step')) {
      fail('RULE_VIOLATION', DOOR_TOKEN_MESSAGES.qr_reused, { reason: 'qr_reused' });
    }
    throw e;
  }
  if (!planning) await ctx.services.days.recompute(ctx, user.id, workDate);

  // Notifications after the commit (PRD 6: N2, N5, N6, N8, N17).
  const computed = plan?.computed;
  const events: NotifyEvent[] = [];
  const base = { orgId, at: now, userId: user.id, name: user.name };
  if (status === 'accepted' || status === 'flagged') {
    if (body.kind === 'in' && computed && computed.result.lateMin > settings.attendance.graceMin) {
      events.push({
        ...base,
        type: 'late_checkin',
        workDate,
        lateMin: computed.result.lateMin,
        inTs: effectiveTs,
        placeName: fence.duty?.place_name ?? fence.site?.name ?? null,
      });
    }
    if (status === 'flagged') {
      events.push({
        ...base,
        type: 'flagged_punch',
        punchId,
        kind: body.kind,
        effectiveTs,
        reasons: riskReasons,
      });
    }
    const end = schedule?.segments.at(-1)?.endTs;
    if (body.kind === 'out' && end !== undefined) {
      const minutesEarly = Math.floor((end - effectiveTs) / 60_000);
      if (minutesEarly > settings.attendance.earlyToleranceMin) {
        events.push({ ...base, type: 'early_checkout', outTs: effectiveTs, minutesEarly });
      }
    }
  } else if (pendingReason === 'offsite_unplanned') {
    events.push({
      ...base,
      type: 'offsite_requested',
      punchId,
      placeName: row.place_name ?? '',
    });
  } else if (sentToOwner || (pendingReason !== 'needs_proof' && pendingReason !== 'strong_mode')) {
    events.push({
      ...base,
      type: 'punch_needs_approval',
      punchId,
      distanceM: fence.distanceM,
      placeName: row.place_name ?? fence.duty?.place_name ?? null,
      note: row.note || null,
    });
  }
  for (const e of events) ctx.waitUntil(safeEmit(ctx, e));

  return punchResult(ctx, row, plan ? { data: plan.data, c: plan.computed } : undefined);
}

// ---- Upgrading a pending punch (PRD 4.5 "Scanning", S-06.4) -------------------------------------

async function ownPendingPunch(ctx: Ctx, id: string): Promise<PunchRow> {
  const user = ctx.user ?? fail('UNAUTHENTICATED');
  const row = await punchById(ctx, id);
  if (!row || row.user_id !== user.id) return fail('NOT_FOUND');
  if (row.status !== 'pending') fail('ALREADY_DECIDED', 'This check-in is no longer waiting.');
  return row;
}

const QR_FIXABLE: readonly (PendingReason | null)[] = [
  'needs_proof',
  'strong_mode',
  'outside_fence',
];

/** Attach a door QR to a pending punch within 10 minutes; it keeps its first time. */
export async function proveWithDoorCode(
  ctx: Ctx,
  id: string,
  body: { qrToken: string; signature: string },
): Promise<PunchResult> {
  const row = await ownPendingPunch(ctx, id);
  const now = ctx.now();
  const owner = await ownerName(ctx);
  if (!QR_FIXABLE.includes(row.pending_reason) || now > row.server_ts + PROOF_WINDOW_MS) {
    fail(
      'RULE_VIOLATION',
      `The door code can no longer confirm this check-in. Send it to ${owner}.`,
      {
        reason: 'proof_window',
      },
    );
  }
  const device = row.device_id
    ? await ctx.db.first<DeviceRow>(
        'SELECT id, user_id, public_jwk, status, approved_at, label FROM devices WHERE org_id = ?org AND id = ?',
        row.device_id,
      )
    : null;
  if (device?.status !== 'approved' || device.user_id !== row.user_id) {
    return denyDevice(
      ctx,
      device ? (device.status === 'approved' ? 'other_user' : device.status) : 'unknown',
      row.device_id ?? '',
      owner,
    );
  }
  const signed = await verifyDeviceSignature(
    json(device.public_jwk, {} as JsonWebKey),
    canonicalJson({ punchId: row.id, qrToken: body.qrToken }),
    body.signature,
  );
  if (!signed) return denyDevice(ctx, 'signature', device.id, owner);

  const check = await checkDoorToken(ctx, body.qrToken, now);
  if (!check.ok)
    fail('RULE_VIOLATION', DOOR_TOKEN_MESSAGES[check.reason], { reason: check.reason });
  const reused = await ctx.db.first<{ id: string }>(
    'SELECT id FROM punches WHERE org_id = ?org AND user_id = ? AND qr_step = ?',
    row.user_id,
    check.step,
  );
  if (reused) fail('RULE_VIOLATION', DOOR_TOKEN_MESSAGES.qr_reused, { reason: 'qr_reused' });

  const reasons: RiskReason[] = riskReasonsOf(row).filter((r) => r !== 'door_qr');
  reasons.push('door_qr');
  const updated: PunchRow = {
    ...row,
    status: 'accepted',
    pending_reason: null,
    qr_step: check.step,
    risk_score: row.risk_score + RISK_POINTS.door_qr,
    risk_reasons_json: JSON.stringify(reasons),
    site_id: row.site_id ?? check.siteId,
  };
  const planning = isPlanningDayService(ctx.services.days);
  const plan = planning
    ? await planDay(ctx, row.user_id, row.work_date, {
        punches: (rows) => rows.map((r) => (r.id === row.id ? updated : r)),
      })
    : null;
  await ctx.db.batch([
    ctx.db.update(
      'punches',
      {
        status: 'accepted',
        pending_reason: null,
        qr_step: check.step,
        risk_score: updated.risk_score,
        risk_reasons_json: updated.risk_reasons_json,
        site_id: updated.site_id,
      },
      "id = ? AND status = 'pending'",
      row.id,
    ),
    ...(plan?.stmts ?? []),
    ctx.services.audit.stmt(ctx, {
      category: 'change',
      action: 'punch.proof',
      entity: 'punch',
      entityId: row.id,
      before: { status: row.status, pendingReason: row.pending_reason },
      after: { status: 'accepted', qrStep: check.step },
    }),
  ]);
  if (!planning) await ctx.services.days.recompute(ctx, row.user_id, row.work_date);
  return punchResult(ctx, updated, plan ? { data: plan.data, c: plan.computed } : undefined);
}

/** "Send to Urmi" for a punch that is waiting (needs proof, outside, unplanned venue). */
export async function requestPunchApproval(
  ctx: Ctx,
  id: string,
  body: { note: string; placeName: string | null },
): Promise<PunchResult> {
  const row = await ownPendingPunch(ctx, id);
  const user = ctx.user ?? fail('UNAUTHENTICATED');
  const placeName = body.placeName ?? row.place_name;
  const pendingReason: PendingReason =
    body.placeName && row.pending_reason !== 'offsite_unplanned'
      ? 'offsite_unplanned'
      : (row.pending_reason ?? 'needs_proof');
  const updated: PunchRow = {
    ...row,
    note: body.note,
    place_name: placeName,
    pending_reason: pendingReason,
  };
  await ctx.db.batch([
    ctx.db.update(
      'punches',
      { note: body.note, place_name: placeName, pending_reason: pendingReason },
      "id = ? AND status = 'pending'",
      row.id,
    ),
    ctx.services.audit.stmt(ctx, {
      category: 'change',
      action: 'punch.request_approval',
      entity: 'punch',
      entityId: row.id,
      before: { pendingReason: row.pending_reason, placeName: row.place_name },
      after: { pendingReason, placeName, note: body.note },
    }),
  ]);
  const now = ctx.now();
  const base = {
    orgId: ctx.orgId as string,
    at: now,
    userId: user.id,
    name: user.name,
    punchId: row.id,
  };
  ctx.waitUntil(
    safeEmit(
      ctx,
      pendingReason === 'offsite_unplanned'
        ? { ...base, type: 'offsite_requested', placeName: placeName ?? '' }
        : {
            ...base,
            type: 'punch_needs_approval',
            distanceM: row.distance_m,
            placeName,
            note: body.note || null,
          },
    ),
  );
  return punchResult(ctx, updated);
}

// ---- Owner-made punches (regularisations, overrides, auto-close changes) --------------------------

/** A punch created by the owner (`source = owner`): no device, no location, accepted. */
export function ownerPunchRow(
  ctx: Ctx,
  p: {
    userId: string;
    kind: PunchKind;
    ts: number;
    workDate: string;
    key: string;
    replaces?: PunchRow | null;
    placeName?: string | null;
    note?: string | null;
  },
): PunchRow {
  const now = ctx.now();
  return {
    id: ulid(now),
    org_id: ctx.orgId as string,
    user_id: p.userId,
    device_id: null,
    kind: p.kind,
    server_ts: now,
    effective_ts: p.ts,
    client_ts: null,
    work_date: p.workDate,
    source: 'owner',
    site_id: p.replaces?.site_id ?? null,
    offsite_duty_id: p.replaces?.offsite_duty_id ?? null,
    place_name: p.placeName ?? p.replaces?.place_name ?? null,
    lat: null,
    lng: null,
    accuracy_m: null,
    distance_m: null,
    distance_bucket: null,
    fence_result: 'none',
    samples_n: null,
    samples_spread_m: null,
    qr_step: null,
    pin_verified: 0,
    sig_verified: 0,
    selfie_key: null,
    selfie_sha256: null,
    selfie_deleted_at: null,
    risk_score: 0,
    risk_reasons_json: '[]',
    status: 'accepted',
    pending_reason: null,
    ip_country: null,
    ip_asn: null,
    device_tz: null,
    clock_skew_ms: null,
    app_version: null,
    client_duration_ms: null,
    idempotency_key: p.key,
    note: p.note ?? null,
    reviewed_by: ctx.user?.id ?? null,
    reviewed_at: now,
    review_note: null,
    replaces_punch_id: p.replaces?.id ?? null,
    created_at: now,
  };
}

export function insertPunchStmt(ctx: Ctx, row: PunchRow): D1PreparedStatement {
  return ctx.db.insert('punches', { ...row, org_id: undefined });
}

/**
 * Commit punch changes of one person-day together with the recomputed day and the given extra
 * statements (audit rows). `apply` maps the stored punches to the new list for the day plan.
 */
export async function commitDayChange(
  ctx: Ctx,
  userId: string,
  workDate: string,
  changes: D1PreparedStatement[],
  apply: (rows: PunchRow[]) => PunchRow[],
  override?: DayOverride | null,
): Promise<void> {
  const planning = isPlanningDayService(ctx.services.days);
  const plan = planning
    ? await planDay(ctx, userId, workDate, {
        punches: apply,
        ...(override !== undefined ? { override } : {}),
      })
    : null;
  await ctx.db.batch([...changes, ...(plan?.stmts ?? [])]);
  if (!planning) await ctx.services.days.recompute(ctx, userId, workDate);
}
