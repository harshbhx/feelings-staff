/**
 * Register view model (PRD 5.2 Register, O-05): the desktop month grid (staff x days with letter,
 * icon and tint, row totals) and the phone list (one 7-day strip per week per person).
 */
import type { RegisterCell, RegisterView } from '@fs/contracts';
import { istTime, nextMonth, prevMonth, weekday } from '@fs/contracts';
import { cellMeta, type StatusMeta } from '../lib/status';

export type RegisterRow = RegisterView['rows'][number];

export interface CellModel {
  date: string;
  /** Null for future days (blank) and days with no data. */
  meta: StatusMeta | null;
  cell: RegisterCell;
  late: boolean;
  flagged: boolean;
  pending: boolean;
  edited: boolean;
}

export function cellModel(date: string, cell: RegisterCell): CellModel {
  return {
    date,
    meta: cell.future ? null : cellMeta(cell.status, cell.tags),
    cell,
    late: cell.lateMin > 0 || cell.tags.includes('late'),
    flagged: cell.tags.includes('flagged'),
    pending: cell.tags.includes('pending'),
    edited: cell.tags.includes('edited'),
  };
}

/** Parts of the cell tooltip, e.g. "Late 25 m · in 10:25 · out 20:04" (PRD 5.2). */
export function cellDetail(cell: RegisterCell): { key: string; values: Record<string, string> }[] {
  if (cell.future) return [];
  const parts: { key: string; values: Record<string, string> }[] = [];
  if (cell.lateMin > 0)
    parts.push({ key: 'owner:register.tip.late', values: { min: String(cell.lateMin) } });
  if (cell.inTs !== null)
    parts.push({ key: 'owner:register.tip.in', values: { time: istTime(cell.inTs) } });
  if (cell.outTs !== null)
    parts.push({ key: 'owner:register.tip.out', values: { time: istTime(cell.outTs) } });
  return parts;
}

/** Totals columns in the order the register shows them (P, H, A, L, late min, OT h, LOP). */
export const TOTAL_COLUMNS = [
  'present',
  'half',
  'absent',
  'leave',
  'lateMin',
  'otHours',
  'lop',
] as const;
export type TotalColumn = (typeof TOTAL_COLUMNS)[number];

export function totalValue(row: RegisterRow, col: TotalColumn): number {
  const t = row.totals;
  switch (col) {
    case 'present':
      return t.present;
    case 'half':
      return t.half;
    case 'absent':
      return t.absent;
    case 'leave':
      return t.leave;
    case 'lateMin':
      return t.lateMin;
    case 'otHours':
      return Math.round((t.otApprovedMin / 60) * 10) / 10;
    case 'lop':
      return t.lop;
  }
}

export interface WeekStrip {
  /** Monday of the week (may be in the previous month). */
  start: string;
  /** Seven slots, Monday first; null where the date is outside the month. */
  days: (CellModel | null)[];
}

/** Weeks (Monday to Sunday) of the month for one person, for the phone strips. */
export function weekStrips(view: RegisterView, row: RegisterRow): WeekStrip[] {
  const strips: WeekStrip[] = [];
  let current: WeekStrip | null = null;
  view.dates.forEach((date, i) => {
    const dow = (weekday(date) + 6) % 7; // Monday = 0
    if (!current || dow === 0) {
      current = { start: date, days: Array.from({ length: 7 }, () => null) };
      strips.push(current);
    }
    const cell = row.cells[i];
    if (cell) current.days[dow] = cellModel(date, cell);
  });
  return strips;
}

/** The week strip that contains `date` (the phone list opens on the current week). */
export function stripIndexFor(strips: readonly WeekStrip[], date: string): number {
  const i = strips.findIndex((s) => s.days.some((d) => d?.date === date));
  return i === -1 ? Math.max(0, strips.length - 1) : i;
}

export function monthNav(month: string, current: string): { prev: string; next: string | null } {
  const next = nextMonth(month);
  return { prev: prevMonth(month), next: next > current ? null : next };
}

/** Weekend columns are shaded lightly; Sunday is the salon's short day. */
export function isSunday(date: string): boolean {
  return weekday(date) === 0;
}

/** The whole salon's totals for the month so far, for the summary bar over the grid (WP-10). */
export function monthTotals(view: RegisterView): Record<TotalColumn, number> {
  const out = Object.fromEntries(TOTAL_COLUMNS.map((c) => [c, 0])) as Record<TotalColumn, number>;
  for (const row of view.rows)
    for (const c of TOTAL_COLUMNS) out[c] = Math.round((out[c] + totalValue(row, c)) * 10) / 10;
  return out;
}

/** What a day cell of 40 px or less shows (PRD 12.3, amendment 2): a letter, or late as minutes. */
export interface CellMark {
  /** `+28`, `+1h` (an hour or more), or the status letter (P, H, A, L, WO, HO, OD, In, –). */
  text: string;
  /** Tint of the cell: a late present day wears the late tint. */
  tone: StatusMeta['chip'];
}

/** The text for lateness: `+28` under an hour, `+1h` from 60 minutes (whole hours). */
export function lateText(min: number): string {
  return min >= 60 ? `+${Math.floor(min / 60)}h` : `+${min}`;
}

export function cellMark(c: CellModel): CellMark | null {
  if (!c.meta) return null;
  if (c.meta.chip === 'present' && c.late)
    return { text: c.cell.lateMin > 0 ? lateText(c.cell.lateMin) : c.meta.letter, tone: 'late' };
  return { text: c.meta.letter, tone: c.meta.chip };
}

/** "Meena Chavda" -> "Meena C." for the 96 px first column; one-word names stay as they are. */
export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  const last = parts.length > 1 ? parts[parts.length - 1] : undefined;
  return last ? `${parts[0]} ${last.charAt(0).toUpperCase()}.` : (parts[0] ?? '');
}

export interface Selection {
  userId: string;
  date: string;
}

const needsLook = (c: RegisterCell) => c.tags.includes('flagged') || c.tags.includes('pending');

/**
 * The person and day the desktop panel opens on: today (or the latest past day of the month), and
 * the first person whose day needs a look (a flagged or waiting punch); else the latest day that
 * has one; else the first person.
 */
export function defaultSelection(view: RegisterView, today: string): Selection | null {
  const first = view.rows[0];
  if (!first) return null;
  const past = view.dates.filter((d) => d <= today);
  const date = past[past.length - 1] ?? view.dates[0] ?? today;
  const at = (d: string) => view.dates.indexOf(d);
  const todayHit = view.rows.find((r) => {
    const c = r.cells[at(date)];
    return c ? needsLook(c) : false;
  });
  if (todayHit) return { userId: todayHit.user.id, date };
  for (let i = past.length - 1; i >= 0; i--) {
    const d = past[i] as string;
    const hit = view.rows.find((r) => {
      const c = r.cells[at(d)];
      return c ? needsLook(c) : false;
    });
    if (hit) return { userId: hit.user.id, date: d };
  }
  return { userId: first.user.id, date };
}
