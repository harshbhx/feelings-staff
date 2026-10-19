/**
 * Away interval rows (PRD 8.2.1, 7.18): the shared row type and the day-level bookkeeping the day
 * recompute runs: close intervals a check-out ended, merge overlaps, re-clip minutes, and total the
 * counted minutes. Owner: WP-9.
 */
import {
  type AwayEndReason,
  type AwayReason,
  type AwaySource,
  type AwayState,
  floorToMinute,
  type Interval,
  type PunchForCalc,
} from '@fs/contracts';
import { awayMinutes } from '@fs/engine';
import type { Computed } from './day';
import type { Ctx } from './ports';

export interface AwayRow {
  id: string;
  user_id: string;
  work_date: string;
  source: AwaySource;
  reason: AwayReason | null;
  reason_note: string | null;
  staff_note: string | null;
  start_ts: number;
  end_ts: number | null;
  end_reason: AwayEndReason | null;
  back_missing: number;
  minutes: number;
  state: AwayState;
  roll_call_id: string | null;
  opened_by: string;
  decided_by: string | null;
  decided_at: number | null;
  edited_by: string | null;
  edited_at: number | null;
  created_at: number;
}

const COUNTED = new Set(['accepted', 'flagged']);

/** The day's counted punches in the engine's shape (as `computeFrom` builds them). */
export function punchesForCalc(c: Pick<Computed, 'punches'>): PunchForCalc[] {
  return c.punches
    .filter((p) => COUNTED.has(p.status))
    .map((p) => ({
      id: p.id,
      kind: p.kind,
      effectiveTs: floorToMinute(p.effective_ts),
      status: p.status,
      source: p.source,
      offsiteDutyId: p.offsite_duty_id,
    }));
}

/** The break punches' window when the salon uses them, else none (the break region is not guessed). */
export function breakWindowOf(
  c: Pick<Computed, 'punches'>,
  breakPunches: boolean,
): Interval | null {
  if (!breakPunches) return null;
  const rows = c.punches
    .filter((p) => COUNTED.has(p.status))
    .sort((a, b) => a.effective_ts - b.effective_ts);
  const start = rows.find((p) => p.kind === 'break_start');
  if (!start) return null;
  const end = rows.find((p) => p.kind === 'break_end' && p.effective_ts > start.effective_ts);
  return end ? { startTs: start.effective_ts, endTs: end.effective_ts } : null;
}

/** Counted minutes of an interval (PRD 7.18 rule 3); an open interval counts 0. */
export function clippedMinutes(
  row: Pick<AwayRow, 'start_ts' | 'end_ts'>,
  c: Computed,
  breakPunches: boolean,
): number {
  return awayMinutes(
    { startTs: row.start_ts, endTs: row.end_ts },
    {
      punches: punchesForCalc(c),
      schedule: c.schedule,
      breakWindow: breakWindowOf(c, breakPunches),
    },
  );
}

/**
 * Day recompute hook (PRD 7.18): intervals still open when the person checked out are closed at the
 * check-out (a step-out is flagged "I'm back missing" and waits for the owner), overlapping intervals
 * of the person become one, minutes follow the day's punches. Returns the counted minutes of the day
 * (confirmed intervals), for `attendance_days.away_min`.
 */
export async function syncAwayRows(
  ctx: Ctx,
  c: Computed,
  opts: { breakPunches: boolean },
): Promise<number> {
  const rows = await ctx.db.all<AwayRow>(
    `SELECT * FROM away_intervals WHERE org_id = ?org AND user_id = ? AND work_date = ?
      ORDER BY start_ts, id`,
    c.userId,
    c.date,
  );
  if (rows.length === 0) return 0;
  const outs = c.punches
    .filter((p) => COUNTED.has(p.status) && p.kind === 'out')
    .sort((a, b) => a.effective_ts - b.effective_ts);

  // 1. A check-out closes what is still open.
  const closed: AwayRow[] = [];
  for (const r of rows) {
    if (r.end_ts !== null) continue;
    const out = outs.find((o) => o.effective_ts > r.start_ts);
    if (!out) continue;
    r.end_ts = out.effective_ts;
    r.end_reason = out.source === 'auto' ? 'auto_close' : 'check_out';
    if (r.source === 'roll_call') {
      r.state = 'confirmed';
    } else {
      r.back_missing = 1;
      r.state = c.creditsOn ? 'pending' : 'ignored';
      closed.push(r);
    }
  }

  // 2. Overlaps become one (union): the earlier row stays, source `mixed`, confirmed wins.
  const merged: AwayRow[] = [];
  const removed: { gone: AwayRow; into: AwayRow }[] = [];
  for (const r of rows) {
    const cur = merged.at(-1);
    if (cur && (cur.end_ts === null || r.start_ts < cur.end_ts)) {
      cur.end_ts = cur.end_ts === null || r.end_ts === null ? null : Math.max(cur.end_ts, r.end_ts);
      if (r.end_ts === null || cur.end_ts === r.end_ts)
        cur.end_reason = r.end_reason ?? cur.end_reason;
      cur.source = cur.source === r.source ? cur.source : 'mixed';
      cur.reason ??= r.reason;
      cur.staff_note ??= r.staff_note;
      if (r.state === 'confirmed') cur.state = 'confirmed';
      cur.back_missing = cur.back_missing === 1 && r.back_missing === 1 ? 1 : 0;
      removed.push({ gone: r, into: cur });
    } else {
      merged.push(r);
    }
  }

  // 3. Minutes follow the punches; write what changed.
  const stmts: D1PreparedStatement[] = [];
  for (const { gone, into } of removed) {
    stmts.push(
      ctx.db.stmt(
        'UPDATE roll_call_marks SET away_interval_id = ? WHERE org_id = ?org AND away_interval_id = ?',
        into.id,
        gone.id,
      ),
      ctx.db.stmt('DELETE FROM away_intervals WHERE org_id = ?org AND id = ?', gone.id),
    );
  }
  let total = 0;
  for (const r of merged) {
    const minutes = r.end_ts === null ? 0 : clippedMinutes(r, c, opts.breakPunches);
    r.minutes = minutes;
    stmts.push(
      ctx.db.update(
        'away_intervals',
        {
          end_ts: r.end_ts,
          end_reason: r.end_reason,
          back_missing: r.back_missing,
          source: r.source,
          reason: r.reason,
          staff_note: r.staff_note,
          state: r.state,
          minutes,
        },
        'id = ?',
        r.id,
      ),
    );
    if (r.state === 'confirmed') total += minutes;
  }
  await ctx.db.batch(stmts);

  for (const r of closed) {
    if (!merged.includes(r) || r.state !== 'pending') continue;
    const u = await ctx.db.first<{ name: string }>(
      'SELECT name FROM users WHERE org_id = ?org AND id = ?',
      r.user_id,
    );
    await ctx.services.notifier
      .emit(ctx, {
        type: 'away_to_confirm',
        orgId: ctx.orgId ?? '',
        at: ctx.now(),
        userId: r.user_id,
        name: u?.name ?? '',
        awayId: r.id,
        workDate: r.work_date,
        startTs: r.start_ts,
        endTs: r.end_ts as number,
        minutes: r.minutes,
        reason: r.reason,
      })
      .catch((e) =>
        console.error(JSON.stringify({ msg: 'presence.notify_failed', error: String(e) })),
      );
  }
  return total;
}
