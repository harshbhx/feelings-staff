/**
 * Presence (PRD 4.18, 7.18, 9.4): the staff side (Step out, I'm back, notes, the optional foreground
 * check, own history) and the owner side (away list, decisions, edits, a person's day). Roll-calls are
 * in rollcall.ts. Presence never changes pay by itself: a counted interval becomes a minus credit
 * through the day recompute (credit-entries.ts). Staff views carry no credits, minutes of credit or
 * rupees. Owner: WP-9.
 */
import {
  type AwayDecideRequest,
  type AwayIntervalStaff,
  type AwayIntervalView,
  type AwayPatch,
  type AwayStaffState,
  type BackRequest,
  canonicalJson,
  type Fix,
  istDate,
  istTime,
  MINUTE_MS,
  type MyPresenceItem,
  type OwnerPresenceDay,
  type PresenceCheckRequest,
  type PresenceHistory,
  type PresenceState,
  type StepOutRequest,
} from '@fs/contracts';
import { bestFence, distanceBucket } from '@fs/engine';
import { json } from '../db';
import { verifyDeviceSignature } from '../lib/crypto';
import { fail } from '../lib/errors';
import { loadOrg } from '../lib/settings';
import { ulid } from '../lib/ulid';
import { computeFrom, loadDayData, personBrief } from './day';
import type { SiteRow } from './door';
import type { Ctx } from './ports';
import { type AwayRow, clippedMinutes } from './presence-rows';

const SESSION_MS = 20 * 60 * MINUTE_MS;
const REASON_LABEL = {
  personal: 'Personal',
  lunch: 'Lunch outside',
  errand: 'Work errand',
  other: 'Other',
} as const;

const me = (ctx: Ctx) => ctx.user ?? fail('UNAUTHENTICATED');

export const STAFF_STATE: Record<AwayRow['state'], AwayStaffState> = {
  open: 'open',
  pending: 'waiting',
  confirmed: 'counted',
  work: 'work',
  ignored: 'ignored',
};

// ---- Loading --------------------------------------------------------------------------------------

/** The person's state in the last 20 hours: their open session's work date and last punch kind. */
export async function openSession(
  ctx: Ctx,
  userId: string,
  at: number,
): Promise<{ workDate: string; kind: 'in' | 'out' | 'break_start' | 'break_end' } | null> {
  return ctx.db.first<{ workDate: string; kind: 'in' | 'out' | 'break_start' | 'break_end' }>(
    `SELECT work_date AS workDate, kind FROM punches
      WHERE org_id = ?org AND user_id = ? AND status IN ('accepted', 'flagged')
        AND effective_ts BETWEEN ? AND ?
      ORDER BY effective_ts DESC, id DESC LIMIT 1`,
    userId,
    at - SESSION_MS,
    at,
  );
}

async function dayInputs(ctx: Ctx, userId: string, date: string) {
  const data = await loadDayData(ctx, [userId], date, date);
  const c = computeFrom(data, userId, date);
  if (!c) return fail('NOT_FOUND', 'This person has no staff profile.');
  return { data, c };
}

async function loadAway(ctx: Ctx, id: string): Promise<AwayRow> {
  const row = await ctx.db.first<AwayRow>(
    'SELECT * FROM away_intervals WHERE org_id = ?org AND id = ?',
    id,
  );
  return row ?? fail('NOT_FOUND', 'That away interval was not found.');
}

async function names(ctx: Ctx, ids: readonly (string | null)[]): Promise<Map<string, string>> {
  const list = [...new Set(ids.filter((x): x is string => x !== null))];
  const rows = await ctx.db.all<{ id: string; name: string }>(
    'SELECT id, name FROM users WHERE org_id = ?org AND id IN (SELECT value FROM json_each(?))',
    JSON.stringify(list),
  );
  return new Map(rows.map((r) => [r.id, r.name]));
}

async function presenceAllowed(ctx: Ctx, userId: string): Promise<boolean> {
  const { settings } = await loadOrg(ctx);
  if (!settings.presence.enabled) return false;
  const p = await ctx.db.first<{ presence_enabled: number | null }>(
    'SELECT presence_enabled FROM staff_profiles WHERE org_id = ?org AND user_id = ?',
    userId,
  );
  return p?.presence_enabled !== 0;
}

async function hasConsent(ctx: Ctx, userId: string): Promise<boolean> {
  const row = await ctx.db.first<{ id: string }>(
    `SELECT id FROM consents WHERE org_id = ?org AND user_id = ? AND kind = 'presence_checks'
        AND withdrawn_at IS NULL LIMIT 1`,
    userId,
  );
  return row !== null;
}

// ---- Views ----------------------------------------------------------------------------------------

export async function staffViews(ctx: Ctx, rows: readonly AwayRow[]): Promise<AwayIntervalStaff[]> {
  const who = await names(
    ctx,
    rows.map((r) => (r.opened_by === r.user_id ? null : r.opened_by)),
  );
  const now = ctx.now();
  return rows.map((r) => ({
    id: r.id,
    workDate: r.work_date,
    source: r.source,
    reason: r.reason,
    markedByName: r.opened_by === r.user_id ? null : (who.get(r.opened_by) ?? null),
    staffNote: r.staff_note,
    startTs: r.start_ts,
    endTs: r.end_ts,
    awayMin: Math.max(
      0,
      Math.floor((r.end_ts ?? now) / MINUTE_MS) - Math.floor(r.start_ts / MINUTE_MS),
    ),
    state: STAFF_STATE[r.state],
  }));
}

export async function ownerViews(ctx: Ctx, rows: readonly AwayRow[]): Promise<AwayIntervalView[]> {
  if (rows.length === 0) return [];
  const people = await ctx.db.all<{
    id: string;
    name: string;
    designation: string | null;
    phone_e164: string | null;
  }>(
    `SELECT u.id, u.name, u.phone_e164, p.designation FROM users u
       LEFT JOIN staff_profiles p ON p.user_id = u.id
      WHERE u.org_id = ?org AND u.id IN (SELECT value FROM json_each(?))`,
    JSON.stringify([...new Set(rows.map((r) => r.user_id))]),
  );
  const byId = new Map(people.map((p) => [p.id, p]));
  const who = await names(
    ctx,
    rows.flatMap((r) => [r.opened_by, r.decided_by]),
  );
  const brief = (id: string) => {
    const n = who.get(id);
    return { id, name: n ?? '' };
  };
  return rows.map((r) => {
    const p = byId.get(r.user_id);
    return {
      id: r.id,
      user: personBrief({
        id: r.user_id,
        name: p?.name ?? '',
        designation: p?.designation ?? null,
        phone_e164: p?.phone_e164 ?? null,
      }),
      workDate: r.work_date,
      source: r.source,
      reason: r.reason,
      reasonNote: r.reason_note,
      staffNote: r.staff_note,
      startTs: r.start_ts,
      endTs: r.end_ts,
      minutes: r.minutes,
      state: r.state,
      endReason: r.end_reason,
      backMissing: r.back_missing === 1,
      rollCallId: r.roll_call_id,
      openedBy: brief(r.opened_by),
      decidedBy: r.decided_by ? brief(r.decided_by) : null,
      decidedAt: r.decided_at,
      editedAt: r.edited_at,
    };
  });
}

// ---- Staff: state, Step out, I'm back, note ------------------------------------------------------

export async function mePresence(ctx: Ctx): Promise<PresenceState> {
  const user = me(ctx);
  const { settings } = await loadOrg(ctx);
  const allowed = await presenceAllowed(ctx, user.id);
  const consent = await hasConsent(ctx, user.id);
  const open = await ctx.db.first<AwayRow>(
    `SELECT * FROM away_intervals WHERE org_id = ?org AND user_id = ? AND end_ts IS NULL
      ORDER BY start_ts DESC LIMIT 1`,
    user.id,
  );
  const sess = await openSession(ctx, user.id, ctx.now());
  const checkedIn = sess !== null && sess.kind !== 'out';
  const fg = settings.presence.foreground;
  let foreground: PresenceState['foreground'];
  if (allowed && consent && fg.enabled && checkedIn) {
    const last = await ctx.db.first<{ check_ts: number }>(
      'SELECT check_ts FROM presence_checks WHERE org_id = ?org AND user_id = ? ORDER BY check_ts DESC LIMIT 1',
      user.id,
    );
    const next = (last?.check_ts ?? 0) + fg.intervalMin * MINUTE_MS;
    foreground = { intervalMin: fg.intervalMin, nextDueAt: Math.max(next, ctx.now()) };
  }
  const [view] = open ? await staffViews(ctx, [open]) : [];
  return {
    enabled: allowed,
    consentNeeded: allowed && !consent,
    stepOutEnabled: allowed && settings.presence.stepOut,
    ...(view ? { openAway: view } : {}),
    ...(foreground ? { foreground } : {}),
  };
}

export async function stepOut(ctx: Ctx, body: StepOutRequest): Promise<AwayIntervalStaff> {
  const user = me(ctx);
  const { settings } = await loadOrg(ctx);
  if (!(await presenceAllowed(ctx, user.id)) || !settings.presence.stepOut) {
    fail('RULE_VIOLATION', 'Step out is not in use.', { reason: 'step_out_off' });
  }
  const now = ctx.now();
  const sess = await openSession(ctx, user.id, now);
  if (!sess || sess.kind === 'out') {
    fail('CONFLICT', "You're not checked in.", { reason: 'not_checked_in' });
  }
  const open = await ctx.db.first<{ id: string }>(
    'SELECT id FROM away_intervals WHERE org_id = ?org AND user_id = ? AND end_ts IS NULL LIMIT 1',
    user.id,
  );
  if (open) fail('CONFLICT', "You're already out.", { reason: 'already_out' });
  const row: AwayRow = {
    id: ulid(now),
    user_id: user.id,
    work_date: sess.workDate,
    source: 'step_out',
    reason: body.reason,
    reason_note: null,
    staff_note: body.note ?? null,
    start_ts: now,
    end_ts: null,
    end_reason: null,
    back_missing: 0,
    minutes: 0,
    state: 'open',
    roll_call_id: null,
    opened_by: user.id,
    decided_by: null,
    decided_at: null,
    edited_by: null,
    edited_at: null,
    created_at: now,
  };
  await ctx.db.batch([
    ctx.db.insert('away_intervals', { ...row }),
    ctx.services.audit.stmt(ctx, {
      category: 'change',
      action: 'presence.step_out',
      entity: 'away_interval',
      entityId: row.id,
      after: { workDate: row.work_date, reason: body.reason, startTs: now },
    }),
  ]);
  await ctx.services.notifier
    .emit(ctx, {
      type: 'staff_stepped_out',
      orgId: ctx.orgId ?? '',
      at: now,
      userId: user.id,
      name: user.name,
      awayId: row.id,
      workDate: row.work_date,
      startTs: now,
      reason: body.reason,
    })
    .catch((e) =>
      console.error(JSON.stringify({ msg: 'presence.notify_failed', error: String(e) })),
    );
  return (await staffViews(ctx, [row]))[0] as AwayIntervalStaff;
}

export async function imBack(ctx: Ctx, _body: BackRequest): Promise<AwayIntervalStaff> {
  const user = me(ctx);
  const row = await ctx.db.first<AwayRow>(
    `SELECT * FROM away_intervals WHERE org_id = ?org AND user_id = ? AND end_ts IS NULL
      ORDER BY start_ts DESC LIMIT 1`,
    user.id,
  );
  if (!row) return fail('CONFLICT', "You're not marked away.", { reason: 'not_away' });
  const now = ctx.now();
  const { c } = await dayInputs(ctx, user.id, row.work_date);
  const stepOutLike = row.source !== 'roll_call';
  const state: AwayRow['state'] = stepOutLike ? (c.creditsOn ? 'pending' : 'ignored') : 'confirmed';
  await ctx.db.batch([
    ctx.db.update(
      'away_intervals',
      { end_ts: now, end_reason: 'back', back_missing: 0, state },
      'id = ?',
      row.id,
    ),
    ctx.services.audit.stmt(ctx, {
      category: 'change',
      action: 'presence.back',
      entity: 'away_interval',
      entityId: row.id,
      before: { endTs: null },
      after: { endTs: now },
    }),
  ]);
  await ctx.services.days.recompute(ctx, user.id, row.work_date);
  const fresh = await loadAway(ctx, row.id);
  if (fresh.state === 'pending') {
    await ctx.services.notifier
      .emit(ctx, {
        type: 'away_to_confirm',
        orgId: ctx.orgId ?? '',
        at: now,
        userId: user.id,
        name: user.name,
        awayId: fresh.id,
        workDate: fresh.work_date,
        startTs: fresh.start_ts,
        endTs: now,
        minutes: fresh.minutes,
        reason: fresh.reason,
      })
      .catch((e) =>
        console.error(JSON.stringify({ msg: 'presence.notify_failed', error: String(e) })),
      );
  }
  return (await staffViews(ctx, [fresh]))[0] as AwayIntervalStaff;
}

export async function awayNote(
  ctx: Ctx,
  id: string,
  body: { note: string },
): Promise<AwayIntervalStaff> {
  const user = me(ctx);
  const row = await loadAway(ctx, id);
  if (row.user_id !== user.id) fail('NOT_FOUND', 'That away interval was not found.');
  if (row.staff_note !== null)
    fail('CONFLICT', 'You already added a note.', { reason: 'has_note' });
  await ctx.db.batch([
    ctx.db.update('away_intervals', { staff_note: body.note }, 'id = ?', id),
    ctx.services.audit.stmt(ctx, {
      category: 'change',
      action: 'presence.note',
      entity: 'away_interval',
      entityId: id,
      after: { note: body.note },
    }),
  ]);
  return (await staffViews(ctx, [{ ...row, staff_note: body.note }]))[0] as AwayIntervalStaff;
}

// ---- Staff: the foreground check -----------------------------------------------------------------

/** The signed payload of a presence check: every field except the signature. */
const signingPayload = (b: PresenceCheckRequest): string => {
  const { signature: _s, ...rest } = b;
  return canonicalJson(rest);
};

/**
 * An optional foreground check (PRD 7.18 rule 6): signed with the device key, one-shot nonce of
 * purpose `presence`. Stores only the result and the distance bucket, never coordinates. It can raise
 * a "seems away" hint; it never makes an interval or credits.
 */
export async function presenceCheck(
  ctx: Ctx,
  body: PresenceCheckRequest,
): Promise<{ result: 'inside' | 'edge' | 'outside' | 'no_fix' }> {
  const user = me(ctx);
  const now = ctx.now();
  if (!(await presenceAllowed(ctx, user.id))) {
    fail('RULE_VIOLATION', 'Presence checks are not in use.', { reason: 'presence_off' });
  }
  const { settings } = await loadOrg(ctx);
  if (!settings.presence.foreground.enabled || !(await hasConsent(ctx, user.id))) {
    fail('RULE_VIOLATION', 'Presence checks are not in use.', { reason: 'checks_off' });
  }
  const device = await ctx.db.first<{
    id: string;
    user_id: string;
    public_jwk: string;
    status: string;
  }>(
    'SELECT id, user_id, public_jwk, status FROM devices WHERE org_id = ?org AND id = ?',
    body.deviceId,
  );
  if (!device || device.user_id !== user.id || device.status !== 'approved') {
    fail('DEVICE_NOT_APPROVED', 'This phone is not approved.', { reason: 'device' });
  }
  const ok = await verifyDeviceSignature(
    json(device.public_jwk, {} as JsonWebKey),
    signingPayload(body),
    body.signature,
  );
  if (!ok)
    fail('DEVICE_NOT_APPROVED', "This phone's security key didn't match.", {
      reason: 'signature',
    });

  const repeat = await ctx.db.first<{ result: PresenceStateResult }>(
    'SELECT result FROM presence_checks WHERE org_id = ?org AND user_id = ? AND idempotency_key = ?',
    user.id,
    body.idempotencyKey,
  );
  if (repeat) return { result: repeat.result };

  const used = await ctx.db.run(
    `UPDATE challenges SET used_at = ?
      WHERE org_id = ?org AND nonce = ? AND purpose = 'presence' AND used_at IS NULL AND user_id = ?
        AND (device_id IS NULL OR device_id = ?) AND expires_at > ?`,
    now,
    body.nonce,
    user.id,
    device.id,
    now,
  );
  if (used.meta.changes !== 1) fail('NONCE_INVALID');

  const sess = await openSession(ctx, user.id, now);
  if (!sess || sess.kind === 'out') {
    fail('CONFLICT', "You're not checked in.", { reason: 'not_checked_in' });
  }

  let result: PresenceStateResult = 'no_fix';
  let fence: 'pass' | 'uncertain' | 'outside' | 'approximate' | null = null;
  let distanceM: number | null = null;
  if (body.fix) {
    const fix: Fix = { ...body.fix, accuracySpreadM: 0 };
    const sites = await ctx.db.all<SiteRow>(
      "SELECT * FROM sites WHERE org_id = ?org AND active = 1 AND kind = 'salon'",
    );
    const best = bestFence(
      fix,
      sites.map((s) => ({
        id: s.id,
        lat: s.lat,
        lng: s.lng,
        radiusM: s.radius_m,
        maxAccuracyM: s.max_accuracy_m,
      })),
    );
    if (best && best.check.result !== 'none') {
      fence = best.check.result;
      distanceM = Math.round(best.check.distanceM);
      result = fence === 'pass' ? 'inside' : fence === 'outside' ? 'outside' : 'edge';
    }
  }
  const checkId = ulid(now);
  await ctx.db.batch([
    ctx.db.insert('presence_checks', {
      id: checkId,
      user_id: user.id,
      work_date: sess.workDate,
      check_ts: now,
      result,
      fence_result: fence,
      distance_m: distanceM,
      accuracy_m: body.fix?.accuracy ?? null,
      distance_bucket: distanceM === null ? null : distanceBucket(distanceM),
      risk_reasons_json: '[]',
      device_id: device.id,
      idempotency_key: body.idempotencyKey,
      created_at: now,
    }),
    ctx.services.audit.stmt(ctx, {
      category: 'change',
      action: 'presence.check',
      entity: 'presence_check',
      entityId: checkId,
      after: { workDate: sess.workDate, result, fence, distanceM },
    }),
  ]);
  return { result };
}

type PresenceStateResult = 'inside' | 'edge' | 'outside' | 'no_fix';

// ---- Staff: own history --------------------------------------------------------------------------

async function ownPresence(ctx: Ctx, userId: string, from: string, to: string) {
  const [marks, away, checks] = await Promise.all([
    ctx.db.all<{ work_date: string; slot_time: string; mark: 'here' | 'not_here' }>(
      `SELECT r.work_date, r.slot_time, m.mark FROM roll_call_marks m
         JOIN roll_calls r ON r.id = m.roll_call_id
        WHERE m.org_id = ?org AND m.user_id = ? AND r.work_date BETWEEN ? AND ?
        ORDER BY r.work_date, r.slot_time`,
      userId,
      from,
      to,
    ),
    ctx.db.all<AwayRow>(
      `SELECT * FROM away_intervals WHERE org_id = ?org AND user_id = ? AND work_date BETWEEN ? AND ?
        ORDER BY start_ts`,
      userId,
      from,
      to,
    ),
    ctx.db.all<{ check_ts: number; result: PresenceStateResult; distance_bucket: string | null }>(
      `SELECT check_ts, result, distance_bucket FROM presence_checks
        WHERE org_id = ?org AND user_id = ? AND work_date BETWEEN ? AND ? ORDER BY check_ts`,
      userId,
      from,
      to,
    ),
  ]);
  return {
    rollCalls: marks.map((m) => ({ workDate: m.work_date, slotTime: m.slot_time, mark: m.mark })),
    away: await staffViews(ctx, away),
    checks: checks.map((k) => ({
      ts: k.check_ts,
      result: k.result,
      distanceBucket: k.distance_bucket as PresenceHistory['checks'][number]['distanceBucket'],
    })),
  };
}

export async function mePresenceHistory(
  ctx: Ctx,
  query: { month: string },
): Promise<PresenceHistory> {
  const user = me(ctx);
  return ownPresence(ctx, user.id, `${query.month}-01`, `${query.month}-31`);
}

/** `MyData.presence`: everything of the last 90 days, newest first. */
export async function myDataPresence(ctx: Ctx, userId: string): Promise<MyPresenceItem[]> {
  const today = istDate(ctx.now());
  const from = istDate(ctx.now() - 90 * 24 * 60 * MINUTE_MS);
  const p = await ownPresence(ctx, userId, from, today);
  return [
    ...p.rollCalls.map((r) => ({ kind: 'roll_call' as const, ...r })),
    ...p.away.map((a) => ({ kind: 'away' as const, ...a })),
    ...p.checks.map((k) => ({ kind: 'check' as const, ...k })),
  ];
}

// ---- Owner: away intervals -----------------------------------------------------------------------

export async function awayList(
  ctx: Ctx,
  query: { state?: AwayRow['state'] | undefined },
): Promise<AwayIntervalView[]> {
  const rows = await ctx.db.all<AwayRow>(
    `SELECT * FROM away_intervals WHERE org_id = ?org ${query.state ? 'AND state = ?' : ''}
      ORDER BY start_ts DESC LIMIT 200`,
    ...(query.state ? [query.state] : []),
  );
  return ownerViews(ctx, rows);
}

async function dayLocked(ctx: Ctx, userId: string, date: string): Promise<boolean> {
  const r = await ctx.db.first<{ locked: number }>(
    'SELECT locked FROM attendance_days WHERE org_id = ?org AND user_id = ? AND work_date = ?',
    userId,
    date,
  );
  return r?.locked === 1;
}

async function refreshDay(ctx: Ctx, row: AwayRow, locked: boolean): Promise<AwayRow> {
  if (!locked) await ctx.services.days.recompute(ctx, row.user_id, row.work_date);
  return loadAway(ctx, row.id);
}

/** Owner or a manager with `rollcall`: edit start, end, reason, note or state (audited old to new). */
export async function awayPatch(ctx: Ctx, id: string, body: AwayPatch): Promise<AwayIntervalView> {
  const user = me(ctx);
  const row = await loadAway(ctx, id);
  const locked = await dayLocked(ctx, row.user_id, row.work_date);
  if (locked && user.role !== 'owner') {
    fail('FORBIDDEN', 'This day is closed. Ask the owner.', { reason: 'day_locked' });
  }
  const start = body.startTs ?? row.start_ts;
  const end = body.endTs ?? row.end_ts;
  if (end !== null && end <= start) {
    fail('VALIDATION', 'The end must be after the start.', { field: 'endTs' });
  }
  if (end === null && body.state !== undefined && body.state !== 'ignored') {
    fail('CONFLICT', 'Still away: end it first.', { reason: 'open' });
  }
  const now = ctx.now();
  const next: Partial<AwayRow> = {
    start_ts: start,
    end_ts: end,
    ...(body.endTs !== undefined ? { end_reason: 'owner_edit' as const, back_missing: 0 } : {}),
    ...(body.reason !== undefined ? { reason: body.reason } : {}),
    ...(body.reasonNote !== undefined ? { reason_note: body.reasonNote } : {}),
    ...(body.state !== undefined
      ? { state: body.state, decided_by: user.id, decided_at: now }
      : {}),
    edited_by: user.id,
    edited_at: now,
  };
  const merged = { ...row, ...next } as AwayRow;
  const { c, data } = await dayInputs(ctx, row.user_id, row.work_date);
  const minutes =
    merged.end_ts === null ? 0 : clippedMinutes(merged, c, data.settings.attendance.breakPunches);
  const decisionAction =
    body.state === 'work'
      ? 'presence.away.work'
      : body.state === 'ignored'
        ? 'presence.away.ignore'
        : body.state === 'confirmed'
          ? 'presence.away.confirm'
          : 'presence.away.edit';
  await ctx.db.batch([
    ctx.db.update('away_intervals', { ...next, minutes }, 'id = ?', id),
    ctx.services.audit.stmt(ctx, {
      category: 'change',
      action: decisionAction,
      entity: 'away_interval',
      entityId: id,
      before: {
        startTs: row.start_ts,
        endTs: row.end_ts,
        reason: row.reason,
        state: row.state,
        minutes: row.minutes,
      },
      after: {
        startTs: merged.start_ts,
        endTs: merged.end_ts,
        reason: merged.reason,
        state: merged.state,
        minutes,
      },
      reason: body.editReason,
    }),
  ]);
  const fresh = await refreshDay(ctx, merged, locked);
  return (await ownerViews(ctx, [fresh]))[0] as AwayIntervalView;
}

/** Owner: decide a pending step-out. Confirm makes the minus entry; Work and Ignore make none. */
export async function awayDecide(
  ctx: Ctx,
  id: string,
  body: AwayDecideRequest,
): Promise<AwayIntervalView> {
  const user = me(ctx);
  const row = await loadAway(ctx, id);
  if (row.state !== 'pending') fail('ALREADY_DECIDED');
  const state: AwayRow['state'] =
    body.decision === 'confirm' ? 'confirmed' : body.decision === 'work' ? 'work' : 'ignored';
  const now = ctx.now();
  const action =
    body.decision === 'confirm'
      ? 'presence.away.confirm'
      : body.decision === 'work'
        ? 'presence.away.work'
        : 'presence.away.ignore';
  await ctx.db.batch([
    ctx.db.update(
      'away_intervals',
      {
        state,
        decided_by: user.id,
        decided_at: now,
        ...(body.note !== undefined ? { reason_note: body.note } : {}),
      },
      'id = ?',
      id,
    ),
    ctx.services.audit.stmt(ctx, {
      category: 'change',
      action,
      entity: 'away_interval',
      entityId: id,
      before: { state: 'pending' },
      after: { state, minutes: row.minutes },
      reason: body.note ?? null,
    }),
  ]);
  const fresh = await refreshDay(
    ctx,
    { ...row, state },
    await dayLocked(ctx, row.user_id, row.work_date),
  );
  return (await ownerViews(ctx, [fresh]))[0] as AwayIntervalView;
}

/** One person's roll-calls, away intervals and checks on a day (owner and managers with `rollcall`). */
export async function presenceDay(
  ctx: Ctx,
  userId: string,
  date: string,
): Promise<OwnerPresenceDay> {
  const [marks, away, checks] = await Promise.all([
    ctx.db.all<{
      rollCallId: string;
      slotTime: string;
      mark: 'here' | 'not_here';
      markedBy: string;
      markedAt: number;
    }>(
      `SELECT m.roll_call_id AS rollCallId, r.slot_time AS slotTime, m.mark, m.marked_by AS markedBy,
              m.marked_at AS markedAt
         FROM roll_call_marks m JOIN roll_calls r ON r.id = m.roll_call_id
        WHERE m.org_id = ?org AND m.user_id = ? AND r.work_date = ? ORDER BY r.slot_time`,
      userId,
      date,
    ),
    ctx.db.all<AwayRow>(
      'SELECT * FROM away_intervals WHERE org_id = ?org AND user_id = ? AND work_date = ? ORDER BY start_ts',
      userId,
      date,
    ),
    ctx.db.all<{
      id: string;
      check_ts: number;
      result: PresenceStateResult;
      distance_bucket: string | null;
    }>(
      `SELECT id, check_ts, result, distance_bucket FROM presence_checks
        WHERE org_id = ?org AND user_id = ? AND work_date = ? ORDER BY check_ts`,
      userId,
      date,
    ),
  ]);
  const who = await names(
    ctx,
    marks.map((m) => m.markedBy),
  );
  return {
    rollCalls: marks.map((m) => ({
      rollCallId: m.rollCallId,
      slotTime: m.slotTime,
      mark: m.mark,
      markedBy: { id: m.markedBy, name: who.get(m.markedBy) ?? '' },
      markedAt: m.markedAt,
    })),
    away: await ownerViews(ctx, away),
    checks: checks.map((k) => ({
      id: k.id,
      ts: k.check_ts,
      result: k.result,
      distanceBucket: k.distance_bucket as OwnerPresenceDay['checks'][number]['distanceBucket'],
    })),
  };
}

/** "Lunch outside, since 14:40" for a roll-call row hint. */
export const stepOutDetail = (r: Pick<AwayRow, 'reason' | 'start_ts'>): string =>
  `${REASON_LABEL[r.reason ?? 'other']}, since ${istTime(r.start_ts)}`;
