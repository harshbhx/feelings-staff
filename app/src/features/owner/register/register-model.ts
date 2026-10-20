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
