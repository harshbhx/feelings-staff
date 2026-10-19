import type {
  DayOverride,
  DayResult,
  DaySchedule,
  DayStatus,
  LeaveCode,
  LeaveOnDay,
  OrgSettings,
  OtWindow,
  PunchForCalc,
  TimeRules,
} from '@fs/contracts';
import { DayTag, IST_OFFSET_MS, MINUTE_MS } from '@fs/contracts';
import { ENGINE_VERSION } from '../version';
import { type Iv, intersect, normalize, subtract, total } from './intervals';

export interface ComputeDayInput {
  schedule: DaySchedule;
  punches: PunchForCalc[];
  preapprovals: OtWindow[];
  leave: LeaveOnDay | null;
  rules: TimeRules;
  override: DayOverride | null;
}

/** TimeRules for computeDay from the org settings (PRD 7.14). */
export function timeRulesFromSettings(settings: OrgSettings): TimeRules {
  const a = settings.attendance;
  return {
    graceMin: a.graceMin,
    earlyToleranceMin: a.earlyToleranceMin,
    makeupEnabled: a.makeupEnabled,
    presentPct: a.presentPct,
    halfPct: a.halfPct,
    breakAfterMin: a.breakAfterMin,
    breakPunches: a.breakPunches,
    otThresholdMin: settings.overtime.thresholdMin,
    otBlockMin: settings.overtime.blockMin,
  };
}

const DAY_MIN = 1440;
const IST_OFFSET_MIN = IST_OFFSET_MS / MINUTE_MS;
const NIGHT_BEFORE = 6 * 60;
const NIGHT_AFTER = 21 * 60;
const KIND_RANK: Record<PunchForCalc['kind'], number> = {
  in: 0,
  break_start: 1,
  break_end: 2,
  out: 3,
};
const CREDIT = { P: 1, H: 0.5, A: 0 } as const;

/** Punch instants are floored to the whole minute before any calculation (PRD 7.1). */
const toMin = (ts: number) => Math.floor(ts / MINUTE_MS);

/** Only accepted and flagged punches count; pending, rejected and superseded do not (PRD 4.4.4). */
const counts = (p: PunchForCalc) => p.status === 'accepted' || p.status === 'flagged';

interface Sessions {
  counted: PunchForCalc[];
  closed: Iv[];
  breaks: Iv[];
  openStart: number | null;
  firstIn: number | null;
  lastOut: number | null;
}

/**
 * Pairs punches in time order: an `in` opens a session (a second `in` while open is ignored), an
 * `out` closes it, break punches (only when break punches are on) open and close a break inside a
 * session. An `out` during a break also ends the break.
 */
function pairPunches(punches: readonly PunchForCalc[], breakPunches: boolean): Sessions {
  const counted = punches
    .filter(counts)
    .sort(
      (a, b) =>
        a.effectiveTs - b.effectiveTs ||
        KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
        a.id.localeCompare(b.id),
    );
  const closed: Iv[] = [];
  const breaks: Iv[] = [];
  let inAt: number | null = null;
  let brAt: number | null = null;
  let firstIn: number | null = null;
  let lastOut: number | null = null;
  for (const p of counted) {
    const m = toMin(p.effectiveTs);
    if (p.kind === 'in') {
      if (inAt === null) {
        inAt = m;
        firstIn ??= m;
      }
    } else if (p.kind === 'out') {
      if (inAt !== null) {
        closed.push([inAt, m]);
        if (brAt !== null) breaks.push([brAt, m]);
        inAt = null;
        brAt = null;
        lastOut = m;
      }
    } else if (breakPunches && inAt !== null) {
      if (p.kind === 'break_start') brAt ??= m;
      else if (brAt !== null) {
        breaks.push([brAt, m]);
        brAt = null;
      }
    }
  }
  return { counted, closed, breaks, openStart: inAt, firstIn, lastOut };
}

interface BreakResult {
  brk: number;
  worked: number;
  overbreak: number;
  notPunched: boolean;
}

/**
 * Break rule (PRD 7.4). `raw` is presence already net of punched breaks. With a punched break the
 * actual break counts and anything over the allowance is over-break. Otherwise the automatic plateau:
 * after `breakAfterMin` of presence, the next `allowance` minutes are the break.
 */
function takeBreak(
  raw: number,
  actual: number,
  punched: boolean,
  allowance: number,
  rules: TimeRules,
): BreakResult {
  if (punched) {
    return {
      brk: actual,
      worked: raw,
      overbreak: Math.max(0, actual - allowance),
      notPunched: false,
    };
  }
  const brk = Math.min(Math.max(raw - rules.breakAfterMin, 0), allowance);
  return { brk, worked: raw - brk, overbreak: 0, notPunched: rules.breakPunches && brk > 0 };
}

/** P / H / A from worked minutes against a scheduled length (PRD 7.7). No presence is always A. */
function ratioStatus(worked: number, scheduled: number, rules: TimeRules): 'P' | 'H' | 'A' {
  if (worked === 0) return 'A';
  if (worked * 100 >= rules.presentPct * scheduled) return 'P';
  if (worked * 100 >= rules.halfPct * scheduled) return 'H';
  return 'A';
}

/** A duty window that starts before 06:00 or ends after 21:00 IST (PRD 7.11). */
function isNightDuty(w: OtWindow): boolean {
  const start = (toMin(w.startTs) + IST_OFFSET_MIN) % DAY_MIN;
  const end = start + toMin(w.endTs) - toMin(w.startTs);
  return w.source === 'duty' && (start < NIGHT_BEFORE || end > NIGHT_AFTER);
}

interface Metrics {
  workedMin: number;
  breakMin: number;
  lateMin: number;
  lateBillableMin: number;
  earlyMin: number;
  earlyBillableMin: number;
  overbreakMin: number;
  makeupMin: number;
  /** Undertime before the "P days only" rule. */
  undertimeMin: number;
  otPreapprovedMin: number;
  otCandidateMin: number;
  offdayCredit: 0 | 0.5 | 1;
  offdayOtMin: number;
  status: DayStatus;
  leaveCode: LeaveCode | null;
  notPunched: boolean;
}

interface Presence {
  presence: Iv[];
  breaks: Iv[];
  punched: boolean;
  windows: Iv[];
  openStart: number | null;
}

const block = (min: number, rules: TimeRules) =>
  Math.floor(min / rules.otBlockMin) * rules.otBlockMin;

/** Working day: break, late/early per segment, make-up, undertime, overtime, status (PRD 7.4-7.7). */
function workDay(input: ComputeDayInput, p: Presence): Metrics {
  const { schedule, rules, leave } = input;
  const segs = normalize(schedule.segments.map((s): Iv => [toMin(s.startTs), toMin(s.endTs)]));
  const b = takeBreak(
    total(intersect(p.presence, segs)),
    total(intersect(p.breaks, segs)),
    p.punched,
    schedule.breakMin,
    rules,
  );

  // Late and early per segment with presence; an open session counts as present to the shift end.
  // On a leave day (full or half) the leave covers the missing time, so nothing is late or early.
  const lastEnd = Math.max(...segs.map((s) => s[1]));
  const timing =
    p.openStart === null
      ? p.presence
      : normalize([...p.presence, [p.openStart, Math.max(p.openStart, lastEnd)]]);
  let lateMin = 0;
  let lateBillableMin = 0;
  let earlyMin = 0;
  let earlyBillableMin = 0;
  for (const seg of leave === null ? segs : []) {
    const inSeg = intersect(timing, [seg]);
    if (inSeg.length === 0) continue;
    const late = Math.min(...inSeg.map((i) => i[0])) - seg[0];
    const early = seg[1] - Math.max(...inSeg.map((i) => i[1]));
    lateMin += late;
    lateBillableMin += Math.max(0, late - rules.graceMin);
    earlyMin += early;
    earlyBillableMin += early > rules.earlyToleranceMin ? early : 0;
  }

  // Pre-approved minutes: presence outside the segments inside a window (before, between or after).
  // After minutes: presence past the last segment that no window covers.
  const preMin = total(intersect(subtract(p.presence, segs), p.windows));
  const afterMin = total(
    subtract(intersect(p.presence, [[lastEnd, Number.POSITIVE_INFINITY]]), p.windows),
  );
  const owed = lateBillableMin + earlyBillableMin + b.overbreak;
  const makeupCap = rules.makeupEnabled ? owed : 0;
  const fromAfter = Math.min(makeupCap, afterMin);
  const fromPre = Math.min(makeupCap - fromAfter, preMin);
  const afterRest = afterMin - fromAfter;

  const leaveCode = leave?.code ?? null;
  let status: DayStatus;
  if (leave !== null && leave.half === 'none') status = leave.paid ? 'L' : 'LOP';
  else if (p.openStart !== null) status = 'OPEN';
  else if (leave !== null) {
    // Half-day leave (P1): the other half is judged against half the scheduled minutes.
    const halfWorked = ratioStatus(b.worked, schedule.scheduledMin / 2, rules) === 'P';
    if (leave.paid) status = halfWorked ? 'L' : 'H';
    else status = halfWorked ? 'H' : 'LOP';
  } else status = ratioStatus(b.worked, schedule.scheduledMin, rules);

  return {
    workedMin: b.worked,
    breakMin: b.brk,
    lateMin,
    lateBillableMin,
    earlyMin,
    earlyBillableMin,
    overbreakMin: b.overbreak,
    makeupMin: fromAfter + fromPre,
    undertimeMin: owed - fromAfter - fromPre,
    otPreapprovedMin: block(preMin - fromPre, rules),
    otCandidateMin: block(afterRest >= rules.otThresholdMin ? afterRest : 0, rules),
    offdayCredit: 0,
    offdayOtMin: 0,
    status,
    leaveCode,
    notPunched: b.notPunched,
  };
}

/**
 * Weekly off or holiday (PRD 7.7): all presence counts with the automatic break. Credit 1 at the
 * present threshold of S_std, 0.5 at the half threshold; below that the minutes become overtime
 * candidates (pre-approved inside a window). Leave on an off day is ignored.
 */
function offDay(input: ComputeDayInput, p: Presence): Metrics {
  const { schedule, rules } = input;
  const b = takeBreak(total(p.presence), total(p.breaks), p.punched, schedule.breakMin, rules);
  const offdayCredit = CREDIT[ratioStatus(b.worked, schedule.stdMin, rules)];
  let otPreapprovedMin = 0;
  let otCandidateMin = 0;
  if (offdayCredit === 0) {
    const pre = Math.min(total(intersect(p.presence, p.windows)), b.worked);
    otPreapprovedMin = block(pre, rules);
    otCandidateMin = block(b.worked - pre, rules);
  }
  return {
    workedMin: b.worked,
    breakMin: b.brk,
    lateMin: 0,
    lateBillableMin: 0,
    earlyMin: 0,
    earlyBillableMin: 0,
    overbreakMin: 0,
    makeupMin: 0,
    undertimeMin: 0,
    otPreapprovedMin,
    otCandidateMin,
    offdayCredit,
    offdayOtMin: otPreapprovedMin + otCandidateMin,
    status: p.openStart === null ? (schedule.dayType as 'WO' | 'HO') : 'OPEN',
    leaveCode: null,
    notPunched: b.notPunched,
  };
}

function notEmployed(schedule: DaySchedule): DayResult {
  return {
    version: ENGINE_VERSION,
    userId: schedule.userId,
    workDate: schedule.workDate,
    dayType: 'NE',
    templateId: null,
    scheduledMin: 0,
    workedMin: 0,
    breakMin: 0,
    lateMin: 0,
    lateBillableMin: 0,
    earlyMin: 0,
    earlyBillableMin: 0,
    overbreakMin: 0,
    makeupMin: 0,
    undertimeMin: 0,
    otPreapprovedMin: 0,
    otCandidateMin: 0,
    status: 'NE',
    leaveCode: null,
    offdayCredit: 0,
    offdayOtMin: 0,
    tags: [],
    firstInTs: null,
    lastOutTs: null,
    open: false,
  };
}

/**
 * Worked minutes, breaks, late/early, make-up, undertime, overtime candidates, status, off-day
 * credit and tags for one person-day (PRD 7.4-7.7). Pure and deterministic: punch order in the input
 * does not matter. Precedence for the status: NE, owner override, full-day leave, open session,
 * half-day leave, worked ratio. Undertime is charged only when the final status is P.
 */
export function computeDay(input: ComputeDayInput): DayResult {
  const { schedule, rules } = input;
  if (schedule.dayType === 'NE') return notEmployed(schedule);

  const s = pairPunches(input.punches, rules.breakPunches);
  const gross = normalize(s.closed);
  const breaks = intersect(normalize(s.breaks), gross);
  const presence: Presence = {
    presence: subtract(gross, breaks),
    breaks,
    punched: s.breaks.length > 0,
    windows: normalize(input.preapprovals.map((w): Iv => [toMin(w.startTs), toMin(w.endTs)])),
    openStart: s.openStart,
  };
  const m = schedule.dayType === 'work' ? workDay(input, presence) : offDay(input, presence);

  let { status, leaveCode } = m;
  const o = input.override;
  if (o !== null) {
    if (o.status !== undefined) {
      status = o.status;
      leaveCode = status === 'LOP' ? 'LOP' : null;
    }
    if (o.leaveCode !== undefined) leaveCode = o.leaveCode;
  }

  const hasPresence = presence.presence.length > 0 || s.openStart !== null;
  const on = new Set<DayTag>();
  const tag = (t: DayTag, when: boolean) => {
    if (when) on.add(t);
  };
  tag('late', m.lateBillableMin > 0);
  tag('early', m.earlyBillableMin > 0);
  tag('ot', m.otPreapprovedMin + m.otCandidateMin > 0);
  tag(
    'offsite',
    s.counted.some((p) => p.offsiteDutyId !== null),
  );
  tag(
    'offline',
    s.counted.some((p) => p.source === 'offline'),
  );
  tag(
    'auto_closed',
    s.counted.some((p) => p.source === 'auto'),
  );
  tag('edited', o !== null || s.counted.some((p) => p.source === 'owner'));
  tag('break_not_punched', m.notPunched);
  tag('night_hours', hasPresence && (schedule.nightHours || input.preapprovals.some(isNightDuty)));
  tag(
    'flagged',
    s.counted.some((p) => p.status === 'flagged'),
  );
  tag(
    'pending',
    input.punches.some((p) => p.status === 'pending'),
  );
  tag('worked_off_day', schedule.dayType !== 'work' && hasPresence);

  return {
    version: ENGINE_VERSION,
    userId: schedule.userId,
    workDate: schedule.workDate,
    dayType: schedule.dayType,
    templateId: schedule.templateId,
    scheduledMin: schedule.scheduledMin,
    workedMin: m.workedMin,
    breakMin: m.breakMin,
    lateMin: m.lateMin,
    lateBillableMin: m.lateBillableMin,
    earlyMin: m.earlyMin,
    earlyBillableMin: m.earlyBillableMin,
    overbreakMin: m.overbreakMin,
    makeupMin: m.makeupMin,
    undertimeMin: status === 'P' ? m.undertimeMin : 0,
    otPreapprovedMin: m.otPreapprovedMin,
    otCandidateMin: m.otCandidateMin,
    status,
    leaveCode,
    offdayCredit: m.offdayCredit,
    offdayOtMin: m.offdayOtMin,
    tags: DayTag.options.filter((t) => on.has(t)),
    firstInTs: s.firstIn === null ? null : s.firstIn * MINUTE_MS,
    lastOutTs: s.lastOut === null ? null : s.lastOut * MINUTE_MS,
    open: s.openStart !== null,
  };
}
