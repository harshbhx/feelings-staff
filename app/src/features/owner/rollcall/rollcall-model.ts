/**
 * Roll-call view model (PRD 4.18.3, 7.18, O-30). Pure: the people checked in at the slot time,
 * each defaulting to Here, except someone whose away interval is still open, who stays Not here
 * (the mark continues the interval) until the owner taps Here to end it. Done sends the marks.
 */
import type { AwayReason, RollCallPerson, RollCallSlot, RollCallSubmit } from '@fs/contracts';

export type Mark = 'here' | 'not_here';

export type Marks = Readonly<Record<string, Mark>>;

/** The starting mark of each person: the saved one, else Here, or Not here while away. */
export function initialMarks(people: readonly RollCallPerson[]): Record<string, Mark> {
  const marks: Record<string, Mark> = {};
  for (const p of people)
    marks[p.userId] = p.mark ?? (p.state === 'away_open' ? 'not_here' : 'here');
  return marks;
}

export function toggleMark(marks: Marks, userId: string): Record<string, Mark> {
  return { ...marks, [userId]: marks[userId] === 'not_here' ? 'here' : 'not_here' };
}

export interface RollCallCounts {
  here: number;
  notHere: number;
  /** Marks that differ from how the roll-call opened. */
  changed: number;
}

export function countMarks(people: readonly RollCallPerson[], marks: Marks): RollCallCounts {
  const start = initialMarks(people);
  let here = 0;
  let notHere = 0;
  let changed = 0;
  for (const p of people) {
    const m = marks[p.userId] ?? start[p.userId];
    if (m === 'not_here') notHere += 1;
    else here += 1;
    if (m !== start[p.userId]) changed += 1;
  }
  return { here, notHere, changed };
}

/**
 * The body for Done (9.4): `notHere` starts or continues an interval from the slot time, `here`
 * ends an open one. Everyone on Here is sent too, so a second Done (an edit) states every mark.
 */
export function submitBody(
  people: readonly RollCallPerson[],
  marks: Marks,
  idempotencyKey: string,
): RollCallSubmit {
  const start = initialMarks(people);
  const notHere: string[] = [];
  const here: string[] = [];
  for (const p of people) {
    if ((marks[p.userId] ?? start[p.userId]) === 'not_here') notHere.push(p.userId);
    else here.push(p.userId);
  }
  return { notHere, here, idempotencyKey };
}

/** The words under a person's name: what the owner should know before marking. */
export type RowHint =
  | { kind: 'away_since'; since: number }
  | { kind: 'stepped_out'; detail: string | null; since: number | null }
  | { kind: 'seems_away' }
  | { kind: 'on_break' };

export function rowHints(p: RollCallPerson): RowHint[] {
  const hints: RowHint[] = [];
  if (p.hint === 'stepped_out')
    hints.push({ kind: 'stepped_out', detail: p.hintDetail ?? null, since: p.awaySince ?? null });
  else if (p.state === 'away_open' && p.awaySince !== undefined)
    hints.push({ kind: 'away_since', since: p.awaySince });
  if (p.hint === 'seems_away') hints.push({ kind: 'seems_away' });
  if (p.state === 'on_break') hints.push({ kind: 'on_break' });
  return hints;
}

/** Slots in time order; a slot can be opened once it is open, done or missed. */
export function canOpenSlot(slot: Pick<RollCallSlot, 'status'>): boolean {
  return slot.status !== 'upcoming';
}

export const AWAY_REASONS: readonly AwayReason[] = ['personal', 'lunch', 'errand', 'other'];

// Same shape as the contract's `HHMM` (a runtime import would widen the shared chunk).
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const isHHMM = (v: string) => HHMM.test(v);
const HHMM_PARTS = /^(\d\d):(\d\d)$/;

/** Epoch ms of `HH:MM` IST on a work date, or null for a time that is not a time. */
export function istTs(workDate: string, hhmm: string): number | null {
  const m = isHHMM(hhmm) ? HHMM_PARTS.exec(hhmm) : null;
  if (!m) return null;
  const base = Date.parse(`${workDate}T00:00:00+05:30`);
  if (!Number.isFinite(base)) return null;
  return base + (Number(m[1]) * 60 + Number(m[2])) * 60_000;
}

/** Roll-call times (Settings -> Presence): one to four, valid, strictly increasing. */
export type TimesProblem = 'none' | 'tooMany' | 'invalid' | 'order' | 'afterClosing';

export function checkRollCallTimes(times: readonly string[], closingTime?: string): TimesProblem {
  if (times.length < 1 || times.length > 4) return 'tooMany';
  if (times.some((t) => !isHHMM(t))) return 'invalid';
  for (let i = 1; i < times.length; i += 1)
    if ((times[i] ?? '') <= (times[i - 1] ?? '')) return 'order';
  if (closingTime && isHHMM(closingTime) && times.some((t) => t >= closingTime))
    return 'afterClosing';
  return 'none';
}

/** The next roll-call time to suggest when adding one: an hour after the last, before closing. */
export function nextTime(times: readonly string[], closingTime = '20:00'): string | null {
  if (times.length >= 4) return null;
  const last = times[times.length - 1] ?? '10:00';
  const m = isHHMM(last) ? HHMM_PARTS.exec(last) : null;
  if (!m) return null;
  const mins = Number(m[1]) * 60 + Number(m[2]) + 60;
  const h = Math.floor(mins / 60);
  const next = `${String(h).padStart(2, '0')}:${m[2]}`;
  return h < 24 && next < closingTime ? next : null;
}
