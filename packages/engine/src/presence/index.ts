/**
 * Presence (PRD 4.18, 7.18): away intervals from roll-call marks and staff step-outs, and "seems away"
 * hints from foreground checks. Pure and deterministic; the caller stores the result. Presence never
 * changes pay by itself: a counted interval becomes a minus credit (PRD 7.17.2), which is money only
 * when the owner settles a balance.
 */
import type {
  AwayEndReason,
  AwayInterval,
  AwayReason,
  AwayState,
  DaySchedule,
  Interval,
  LeaveOnDay,
  PresenceCheck,
  PresenceRules,
  PunchForCalc,
  RollCallMark,
  SeemsAway,
  StepOut,
} from '@fs/contracts';
import { MINUTE_MS } from '@fs/contracts';
import { type Iv, intersect, normalize, subtract, total } from '../day/intervals';

export interface BuildAwayInput {
  /** This person's marks on this day, in any order. */
  rollCalls: readonly RollCallMark[];
  stepOuts: readonly StepOut[];
  checks: readonly PresenceCheck[];
  punches: readonly PunchForCalc[];
  schedule: DaySchedule;
  /** The day's break window (PRD 4.18.7); away minutes inside it are not counted again. */
  breakWindow: Interval | null;
  leave: LeaveOnDay | null;
  rules: PresenceRules;
  /** I'm back taps (server time) that end an interval a roll-call opened; step-outs carry their own end. */
  backs?: readonly number[];
  /** Server time now: an interval with nothing to end it before now stays open. Absent: the day is over. */
  nowTs?: number;
}

export interface BuildAwayResult {
  intervals: AwayInterval[];
  /** The "seems away" hint still standing at the end of the input (at most one). */
  hints: SeemsAway[];
}

/** Only accepted and flagged punches count (PRD 4.4.4), as in computeDay. */
const counts = (p: PunchForCalc) => p.status === 'accepted' || p.status === 'flagged';
const toMin = (ts: number) => Math.floor(ts / MINUTE_MS);

interface Day {
  segs: Iv[];
  /** Presence span `[first in, last out)` in minutes; open to the end while checked in. */
  span: Iv[];
  outs: Array<{ ts: number; auto: boolean }>;
  brk: Iv[];
}

function dayOf(
  punches: readonly PunchForCalc[],
  schedule: DaySchedule,
  breakWindow: Interval | null,
): Day {
  const counted = punches.filter(counts).sort((a, b) => a.effectiveTs - b.effectiveTs);
  const firstIn = counted.find((p) => p.kind === 'in');
  const last = counted.filter((p) => p.kind === 'in' || p.kind === 'out').at(-1);
  const outs = counted
    .filter((p) => p.kind === 'out')
    .map((p) => ({ ts: p.effectiveTs, auto: p.source === 'auto' }));
  const end = last?.kind === 'out' ? toMin(last.effectiveTs) : Number.POSITIVE_INFINITY;
  return {
    segs: normalize(schedule.segments.map((s): Iv => [toMin(s.startTs), toMin(s.endTs)])),
    span: firstIn === undefined ? [] : normalize([[toMin(firstIn.effectiveTs), end]]),
    outs,
    brk: breakWindow === null ? [] : [[toMin(breakWindow.startTs), toMin(breakWindow.endTs)]],
  };
}

function counted(startTs: number, endTs: number | null, d: Day): number {
  if (endTs === null) return 0;
  const iv: Iv[] = [[toMin(startTs), toMin(endTs)]];
  return total(subtract(intersect(intersect(iv, d.segs), d.span), d.brk));
}

/**
 * Counted minutes of one interval (PRD 7.18 rule 3): inside a shift segment and inside the day's
 * presence `[first in, last out)`, minus the break window. For recomputing an interval after the owner
 * edits its start or end, or after the day's punches change; an open interval counts 0.
 */
export function awayMinutes(
  interval: { startTs: number; endTs: number | null },
  ctx: { punches: readonly PunchForCalc[]; schedule: DaySchedule; breakWindow: Interval | null },
): number {
  return counted(
    interval.startTs,
    interval.endTs,
    dayOf(ctx.punches, ctx.schedule, ctx.breakWindow),
  );
}

interface Part {
  startTs: number;
  endTs: number | null;
  rollCall: boolean;
  reason: AwayReason | null;
  state: AwayState;
  endReason: AwayEndReason | null;
  backMissing: boolean;
  rollCallIds: string[];
  stepOutIds: string[];
}

interface Closer {
  ts: number;
  reason: AwayEndReason;
}

/** Decided step-out states win over undecided ones when step-outs merge. */
const STATE_RANK: Record<AwayState, number> = {
  confirmed: 0,
  open: 1,
  pending: 2,
  work: 3,
  ignored: 4,
};

function merge(parts: Part[]): Part[] {
  const out: Part[] = [];
  for (const p of [...parts].sort((a, b) => a.startTs - b.startTs)) {
    const cur = out.at(-1);
    if (cur === undefined || (cur.endTs !== null && p.startTs >= cur.endTs)) {
      out.push({ ...p, rollCallIds: [...p.rollCallIds], stepOutIds: [...p.stepOutIds] });
      continue;
    }
    const later = cur.endTs === null || (p.endTs !== null && p.endTs <= cur.endTs) ? cur : p;
    cur.endTs = later.endTs;
    cur.endReason = later.endReason;
    cur.backMissing = later.backMissing;
    cur.rollCall ||= p.rollCall;
    cur.reason ??= p.reason;
    if (STATE_RANK[p.state] < STATE_RANK[cur.state]) cur.state = p.state;
    cur.rollCallIds.push(...p.rollCallIds);
    cur.stepOutIds.push(...p.stepOutIds);
  }
  return out;
}

/**
 * Away intervals and hints for one person-day (PRD 7.18).
 *
 * 1. A roll-call **Not here** starts an interval at the slot time, or continues one already open.
 *    A step-out starts at its tap. An interval ends at the first of: I'm back, the next roll-call
 *    **Here**, check-out (auto-close for an `auto` out punch) or the end of the shift segment; a
 *    step-out closed by anything but I'm back is `backMissing`. Nothing before `nowTs`: still open.
 * 2. Overlapping intervals merge (source `mixed` when both kinds); an owner-marked part makes the
 *    merged interval confirmed.
 * 3. Minutes are clipped to the shift segments and presence, minus the break window; closed
 *    intervals shorter than `minAwayMin` are dropped.
 * 4. Roll-call intervals are confirmed at once; a closed step-out is pending until the owner decides
 *    (its stored `state` is kept).
 * 5. Nothing on a day off, on full-day leave, before the first check-in, or with presence off.
 * 6. An `outside` foreground check inside a segment and outside the break window raises a hint; the
 *    next inside or edge check, or a check-out, clears it. A hint never makes an interval.
 */
export function buildAwayIntervals(input: BuildAwayInput): BuildAwayResult {
  const { schedule, rules } = input;
  const d = dayOf(input.punches, schedule, input.breakWindow);
  const skip =
    !rules.enabled ||
    schedule.dayType !== 'work' ||
    d.span.length === 0 ||
    (input.leave !== null && input.leave.half === 'none');
  if (skip) return { intervals: [], hints: [] };

  const now = input.nowTs ?? Number.POSITIVE_INFINITY;
  const marks = [...input.rollCalls].sort((a, b) => a.slotTs - b.slotTs);
  const heres = marks.filter((m) => m.mark === 'here').map((m) => m.slotTs);
  const backs = [...(input.backs ?? [])];
  const segEnd = (ts: number) => {
    const ends = schedule.segments.filter((s) => s.endTs > ts).map((s) => s.endTs);
    return ends.length === 0 ? ts : Math.min(...ends);
  };

  /** The first event after `start` that ends an interval; null while nothing has ended it yet. */
  const close = (start: number, withBack: boolean): Closer | null => {
    const after = (ts: number[]) => ts.filter((t) => t > start).sort((a, b) => a - b)[0];
    const candidates: Array<Closer | null> = [
      withBack ? at(after(backs), 'back') : null,
      at(after(heres), 'roll_call_here'),
      ...d.outs
        .filter((o) => o.ts > start)
        .slice(0, 1)
        .map((o): Closer => ({ ts: o.ts, reason: o.auto ? 'auto_close' : 'check_out' })),
      { ts: segEnd(start), reason: 'shift_end' },
    ];
    const first = candidates
      .filter((c): c is Closer => c !== null)
      .reduce((a, b) => (b.ts < a.ts ? b : a));
    return first.ts <= now ? first : null;
  };

  const parts: Part[] = [];
  let open: Part | null = null;
  for (const m of marks) {
    if (m.mark !== 'not_here') continue;
    if (open !== null && (open.endTs === null || open.endTs > m.slotTs)) {
      open.rollCallIds.push(m.rollCallId);
      continue;
    }
    const end = close(m.slotTs, true);
    open = {
      startTs: m.slotTs,
      endTs: end?.ts ?? null,
      rollCall: true,
      reason: null,
      state: 'confirmed',
      endReason: end?.reason ?? null,
      backMissing: false,
      rollCallIds: [m.rollCallId],
      stepOutIds: [],
    };
    parts.push(open);
  }

  for (const s of input.stepOuts) {
    // A stored end is I'm back, or (back missing) whatever closed it; an end matching no closer was
    // set by the owner.
    const auto = close(s.startTs, false);
    let end = auto;
    if (s.endTs !== null) {
      const by = auto?.ts === s.endTs ? auto.reason : 'owner_edit';
      end = { ts: s.endTs, reason: s.backMissing ? by : 'back' };
    }
    parts.push({
      startTs: s.startTs,
      endTs: end?.ts ?? null,
      rollCall: false,
      reason: s.reason,
      state: s.state,
      endReason: end?.reason ?? null,
      backMissing: s.endTs === null ? end !== null : s.backMissing,
      rollCallIds: [],
      stepOutIds: [s.id],
    });
  }

  const intervals = merge(parts)
    .filter((p) => p.endTs === null || toMin(p.endTs) - toMin(p.startTs) >= rules.minAwayMin)
    .map(
      (p): AwayInterval => ({
        startTs: p.startTs,
        endTs: p.endTs,
        source: p.rollCall ? (p.stepOutIds.length > 0 ? 'mixed' : 'roll_call') : 'step_out',
        reason: p.reason,
        minutes: counted(p.startTs, p.endTs, d),
        state: p.rollCall
          ? 'confirmed'
          : p.endTs === null
            ? 'open'
            : p.state === 'open'
              ? 'pending'
              : p.state,
        endReason: p.endReason,
        backMissing: p.backMissing,
        rollCallIds: p.rollCallIds,
        stepOutIds: p.stepOutIds,
      }),
    );

  return { intervals, hints: hints(input.checks, d) };
}

function at(ts: number | undefined, reason: AwayEndReason): Closer | null {
  return ts === undefined ? null : { ts, reason };
}

function hints(checks: readonly PresenceCheck[], d: Day): SeemsAway[] {
  const inside = (ts: number) =>
    total(subtract(intersect(intersect([[toMin(ts), toMin(ts) + 1]], d.segs), d.span), d.brk)) > 0;
  let since: number | null = null;
  let lastCheckTs = 0;
  for (const c of [...checks].sort((a, b) => a.ts - b.ts)) {
    if (c.result === 'no_fix' || !inside(c.ts)) continue;
    if (c.result !== 'outside') since = null;
    else {
      if (since === null) since = c.ts;
      lastCheckTs = c.ts;
    }
  }
  if (since === null) return [];
  const sinceTs = since;
  return d.outs.some((o) => o.ts > sinceTs) ? [] : [{ sinceTs, lastCheckTs }];
}
