/**
 * Roll-calls (PRD 4.18.3, 9.4): slots from settings, who was checked in at the slot time, and the
 * submit that starts, continues or ends away intervals. "Not here" counts at once (a confirmed
 * interval from the slot time); everything is editable until the day is locked and audited old to
 * new. Open to the owner and to managers with `rollcall`. Owner: WP-9.
 */
import {
  istDate,
  istToEpoch,
  MINUTE_MS,
  type OrgSettings,
  type RollCallDay,
  type RollCallResult,
  type RollCallSlotStatus,
  type RollCallSubmit,
  type RollCallView,
} from '@fs/contracts';
import { fail } from '../lib/errors';
import { loadOrg } from '../lib/settings';
import { ulid } from '../lib/ulid';
import { computeFrom, loadDayData } from './day';
import type { Ctx } from './ports';
import { stepOutDetail } from './presence';
import type { AwayRow } from './presence-rows';

export interface RollCallRow {
  id: string;
  work_date: string;
  slot_time: string;
  slot_ts: number;
  reminded_at: number | null;
  submitted_by: string | null;
  submitted_at: number | null;
  edited_at: number | null;
  created_at: number;
}

/** A slot not done within 30 minutes is missed (N33). */
export const MISSED_AFTER_MS = 30 * MINUTE_MS;

export const slotStatus = (r: RollCallRow, now: number): RollCallSlotStatus =>
  r.submitted_at !== null
    ? 'done'
    : now < r.slot_ts
      ? 'upcoming'
      : now < r.slot_ts + MISSED_AFTER_MS
        ? 'open'
        : 'missed';

const actor = (ctx: Ctx) => ctx.user ?? fail('UNAUTHENTICATED');

/** The day's slots from settings; rows are created on first use so every slot has an id. */
export async function ensureSlots(
  ctx: Ctx,
  date: string,
  settings: OrgSettings,
): Promise<RollCallRow[]> {
  const now = ctx.now();
  await ctx.db.batch(
    settings.presence.rollCallTimes.map((time) =>
      ctx.db.stmt(
        `INSERT OR IGNORE INTO roll_calls (id, org_id, work_date, slot_time, slot_ts, created_at)
         VALUES (?, ?org, ?, ?, ?, ?)`,
        ulid(now),
        date,
        time,
        istToEpoch(date, time),
        now,
      ),
    ),
  );
  return ctx.db.all<RollCallRow>(
    'SELECT * FROM roll_calls WHERE org_id = ?org AND work_date = ? ORDER BY slot_time',
    date,
  );
}

async function loadRollCall(ctx: Ctx, id: string): Promise<RollCallRow> {
  const r = await ctx.db.first<RollCallRow>(
    'SELECT * FROM roll_calls WHERE org_id = ?org AND id = ?',
    id,
  );
  return r ?? fail('NOT_FOUND', 'That roll-call was not found.');
}

async function userNames(ctx: Ctx, ids: readonly string[]): Promise<Map<string, string>> {
  const rows = await ctx.db.all<{ id: string; name: string }>(
    'SELECT id, name FROM users WHERE org_id = ?org AND id IN (SELECT value FROM json_each(?))',
    JSON.stringify([...new Set(ids)]),
  );
  return new Map(rows.map((r) => [r.id, r.name]));
}

export async function rollCallDay(
  ctx: Ctx,
  query: { date?: string | undefined },
): Promise<RollCallDay> {
  const { settings } = await loadOrg(ctx);
  const date = query.date ?? istDate(ctx.now());
  const rows = settings.presence.enabled ? await ensureSlots(ctx, date, settings) : [];
  const names = await userNames(
    ctx,
    rows.flatMap((r) => (r.submitted_by ? [r.submitted_by] : [])),
  );
  const now = ctx.now();
  return {
    slots: rows.map((r) => ({
      id: r.id,
      slotTime: r.slot_time,
      status: slotStatus(r, now),
      ...(r.submitted_by
        ? { submittedBy: { id: r.submitted_by, name: names.get(r.submitted_by) ?? '' } }
        : {}),
    })),
  };
}

/** The slot worth showing on Today: the latest one that has started and is not done, else none. */
export async function todayRollCall(
  ctx: Ctx,
  date: string,
): Promise<{ id: string; slotTime: string; status: RollCallSlotStatus } | null> {
  const rows = await ctx.db.all<RollCallRow>(
    'SELECT * FROM roll_calls WHERE org_id = ?org AND work_date = ? ORDER BY slot_ts DESC',
    date,
  );
  const now = ctx.now();
  for (const r of rows) {
    if (r.slot_ts > now || r.submitted_at !== null) continue;
    return { id: r.id, slotTime: r.slot_time, status: slotStatus(r, now) };
  }
  return null;
}

interface Present {
  userId: string;
  name: string;
  inAt: number;
  onBreak: boolean;
}

/** Who was checked in at the slot time: not on leave, not on a venue duty, presence not excluded. */
export async function checkedInAt(ctx: Ctx, date: string, slotTs: number): Promise<Present[]> {
  const data = await loadDayData(ctx, null, date, date);
  const out: Present[] = [];
  for (const p of data.people.values()) {
    if (p.status !== 'active' || p.role === 'owner' || p.presence_enabled === 0) continue;
    const c = computeFrom(data, p.user_id, date);
    if (!c || (c.leave && c.leave.half === 'none')) continue;
    if ((data.duties.get(p.user_id) ?? []).some((d) => d.start_ts <= slotTs && slotTs <= d.end_ts))
      continue;
    const rows = c.punches
      .filter(
        (x) => (x.status === 'accepted' || x.status === 'flagged') && x.effective_ts <= slotTs,
      )
      .sort((a, b) => a.effective_ts - b.effective_ts || a.id.localeCompare(b.id));
    const last = rows.at(-1);
    if (!last || last.kind === 'out') continue;
    const firstIn = rows.find((x) => x.kind === 'in');
    if (!firstIn) continue;
    out.push({
      userId: p.user_id,
      name: p.name,
      inAt: firstIn.effective_ts,
      onBreak: last.kind === 'break_start',
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function rollCallView(ctx: Ctx, id: string): Promise<RollCallView> {
  const rc = await loadRollCall(ctx, id);
  const present = await checkedInAt(ctx, rc.work_date, rc.slot_ts);
  const ids = JSON.stringify(present.map((p) => p.userId));
  const [away, checks] = await Promise.all([
    ctx.db.all<AwayRow>(
      `SELECT * FROM away_intervals WHERE org_id = ?org AND work_date = ?
          AND start_ts <= ? AND (end_ts IS NULL OR end_ts > ?)
          AND user_id IN (SELECT value FROM json_each(?))`,
      rc.work_date,
      rc.slot_ts,
      rc.slot_ts,
      ids,
    ),
    ctx.db.all<{ user_id: string; result: string; check_ts: number }>(
      `SELECT user_id, result, check_ts FROM presence_checks WHERE org_id = ?org AND work_date = ?
          AND check_ts <= ? AND result <> 'no_fix' AND user_id IN (SELECT value FROM json_each(?))
        ORDER BY check_ts`,
      rc.work_date,
      rc.slot_ts,
      ids,
    ),
  ]);
  const lastCheck = new Map(checks.map((c) => [c.user_id, c.result] as const));
  return {
    id: rc.id,
    slotTime: rc.slot_time,
    people: present.map((p) => {
      const a = away.find((x) => x.user_id === p.userId);
      const seems = lastCheck.get(p.userId) === 'outside';
      const state = a
        ? ('away_open' as const)
        : p.onBreak
          ? ('on_break' as const)
          : ('here' as const);
      return {
        userId: p.userId,
        name: p.name,
        inAt: p.inAt,
        state,
        ...(a ? { awaySince: a.start_ts } : {}),
        ...(a && a.source === 'step_out'
          ? { hint: 'stepped_out' as const, hintDetail: stepOutDetail(a) }
          : seems
            ? { hint: 'seems_away' as const }
            : {}),
      };
    }),
  };
}

interface MarkRow {
  user_id: string;
  mark: 'here' | 'not_here';
}

/**
 * Submit (or edit) a roll-call. People in `notHere` start or continue an away interval from the slot
 * time; people in `here` end an open one; everyone else checked in is recorded as here. Submitting
 * again replaces the marks (audited `rollcall.edit`).
 */
export async function rollCallSubmit(
  ctx: Ctx,
  id: string,
  body: RollCallSubmit,
): Promise<RollCallResult> {
  const user = actor(ctx);
  const rc = await loadRollCall(ctx, id);
  const locked = await ctx.db.first<{ n: number }>(
    'SELECT COUNT(*) AS n FROM attendance_days WHERE org_id = ?org AND work_date = ? AND locked = 1',
    rc.work_date,
  );
  if ((locked?.n ?? 0) > 0) fail('MONTH_LOCKED', 'This day is closed.');
  const present = await checkedInAt(ctx, rc.work_date, rc.slot_ts);
  const here = new Set(present.map((p) => p.userId));
  for (const uid of [...body.notHere, ...body.here]) {
    if (!here.has(uid)) {
      fail('VALIDATION', 'That person was not checked in at this time.', { field: 'notHere' });
    }
  }
  if (body.notHere.some((u) => body.here.includes(u))) {
    fail('VALIDATION', 'Someone is on both lists.', { field: 'here' });
  }
  const notHere = new Set(body.notHere);
  const now = ctx.now();
  const before = await ctx.db.all<MarkRow>(
    'SELECT user_id, mark FROM roll_call_marks WHERE org_id = ?org AND roll_call_id = ?',
    rc.id,
  );
  const open = await ctx.db.all<AwayRow>(
    `SELECT * FROM away_intervals WHERE org_id = ?org AND work_date = ?
        AND start_ts <= ? AND (end_ts IS NULL OR end_ts > ?)
        AND user_id IN (SELECT value FROM json_each(?))`,
    rc.work_date,
    rc.slot_ts,
    rc.slot_ts,
    JSON.stringify([...here]),
  );

  const result: RollCallResult = { started: [], continued: [], ended: [] };
  const stmts: D1PreparedStatement[] = [
    ctx.db.stmt('DELETE FROM roll_call_marks WHERE org_id = ?org AND roll_call_id = ?', rc.id),
  ];
  const inputs = await loadDayData(ctx, null, rc.work_date, rc.work_date);
  for (const p of present) {
    const mark: 'here' | 'not_here' = notHere.has(p.userId) ? 'not_here' : 'here';
    const current = open.find((a) => a.user_id === p.userId && a.end_ts === null);
    const own = open.find((a) => a.user_id === p.userId && a.roll_call_id === rc.id);
    let intervalId: string | null = null;
    if (mark === 'not_here') {
      if (current) {
        intervalId = current.id;
        result.continued.push(p.userId);
      } else {
        const covered = open.find((a) => a.user_id === p.userId);
        if (covered) {
          intervalId = covered.id;
          result.continued.push(p.userId);
        } else {
          intervalId = ulid(now);
          const out = computeFrom(inputs, p.userId, rc.work_date)
            ?.punches.filter(
              (x) =>
                (x.status === 'accepted' || x.status === 'flagged') &&
                x.kind === 'out' &&
                x.effective_ts > rc.slot_ts,
            )
            .sort((a, b) => a.effective_ts - b.effective_ts)[0];
          stmts.push(
            ctx.db.insert('away_intervals', {
              id: intervalId,
              user_id: p.userId,
              work_date: rc.work_date,
              source: 'roll_call',
              reason: null,
              start_ts: rc.slot_ts,
              end_ts: out?.effective_ts ?? null,
              end_reason: out ? (out.source === 'auto' ? 'auto_close' : 'check_out') : null,
              back_missing: 0,
              minutes: 0,
              state: 'confirmed',
              roll_call_id: rc.id,
              opened_by: user.id,
              created_at: now,
            }),
          );
          result.started.push(p.userId);
        }
      }
    } else if (own) {
      // Editing: this roll-call made the interval, and now says Here, so there is none.
      result.ended.push(p.userId);
      stmts.push(
        // Later roll-calls may point at this interval (a continued Not here): let go first.
        ctx.db.stmt(
          'UPDATE roll_call_marks SET away_interval_id = NULL WHERE org_id = ?org AND away_interval_id = ?',
          own.id,
        ),
        ctx.db.stmt('DELETE FROM away_intervals WHERE org_id = ?org AND id = ?', own.id),
      );
    } else if (current) {
      // Here ends an interval that is still open: the roll-call is what closed it.
      result.ended.push(p.userId);
      stmts.push(
        ctx.db.update(
          'away_intervals',
          {
            end_ts: rc.slot_ts,
            end_reason: 'roll_call_here',
            ...(current.source === 'roll_call'
              ? { state: 'confirmed' as const }
              : { back_missing: 1, state: 'pending' as const }),
          },
          'id = ?',
          current.id,
        ),
      );
    }
    stmts.push(
      ctx.db.insert('roll_call_marks', {
        id: ulid(now),
        roll_call_id: rc.id,
        user_id: p.userId,
        mark,
        away_interval_id: intervalId,
        marked_by: user.id,
        marked_at: now,
      }),
    );
  }
  const edited = rc.submitted_at !== null;
  stmts.push(
    ctx.db.update(
      'roll_calls',
      edited ? { edited_at: now } : { submitted_by: user.id, submitted_at: now },
      'id = ?',
      rc.id,
    ),
    ctx.services.audit.stmt(ctx, {
      category: 'change',
      action: edited ? 'rollcall.edit' : 'rollcall.submit',
      entity: 'roll_call',
      entityId: rc.id,
      before: edited
        ? { notHere: before.filter((m) => m.mark === 'not_here').map((m) => m.user_id) }
        : null,
      after: {
        slotTime: rc.slot_time,
        notHere: body.notHere,
        here: body.here,
        started: result.started,
        continued: result.continued,
        ended: result.ended,
      },
    }),
  );
  await ctx.db.batch(stmts);
  // Intervals ended by a Here mark, or new ones, change minutes and credit entries.
  const touched = new Set([...result.started, ...result.ended, ...result.continued]);
  for (const uid of touched) await ctx.services.days.recompute(ctx, uid, rc.work_date);
  return result;
}
