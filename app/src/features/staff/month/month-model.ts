/**
 * My month (PRD 5.1 Month; AC S-11): a Monday-first calendar grid of the month, each day with its
 * status from `attendance_days`, today marked, future days blank.
 */
import { type DaySummary, daysInMonth, type DayStatus as Status, weekday } from '@fs/contracts';
import type { DayStatus as ChipStatus } from '@fs/ui';

export interface CalendarCell {
  date: string;
  day: number;
  summary: DaySummary | null;
  isToday: boolean;
  isFuture: boolean;
}

/** Weeks of 7 cells (null = padding outside the month), Monday first. */
export function calendarWeeks(
  month: string,
  days: readonly DaySummary[],
  today: string,
): (CalendarCell | null)[][] {
  const byDate = new Map(days.map((d) => [d.workDate, d]));
  const n = daysInMonth(month);
  const lead = (weekday(`${month}-01`) + 6) % 7; // Monday = 0
  const cells: (CalendarCell | null)[] = Array.from({ length: lead }, () => null);
  for (let i = 1; i <= n; i++) {
    const date = `${month}-${String(i).padStart(2, '0')}`;
    cells.push({
      date,
      day: i,
      summary: byDate.get(date) ?? null,
      isToday: date === today,
      isFuture: date > today,
    });
  }
  while (cells.length % 7) cells.push(null);
  const weeks: (CalendarCell | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** The chip a day shows (PRD 12.3). `null` = nothing to show (not employed, empty). */
export function chipStatusOf(d: DaySummary): ChipStatus | null {
  const map: Record<Status, ChipStatus | null> = {
    P: 'present',
    H: 'half',
    A: 'absent',
    L: 'leave',
    LOP: 'leave',
    WO: 'off',
    HO: 'holiday',
    NE: null,
    OPEN: d.firstInTs !== null ? 'present' : null,
  };
  if (d.tags.includes('pending') && d.status === 'OPEN') return 'waiting';
  return map[d.status];
}

/**
 * A late present day shows its minutes instead of the P (PRD 12.3, amendment 2): `+28` under an
 * hour, `+1h` from 60 minutes (whole hours). Null for every other day.
 */
export function lateMark(d: DaySummary): string | null {
  if (d.status !== 'P' || d.lateMin <= 0) return null;
  return d.lateMin >= 60 ? `+${Math.floor(d.lateMin / 60)}h` : `+${d.lateMin}`;
}

/** Previous and next month, never past the current month. */
export function monthNav(month: string, current: string): { prev: string; next: string | null } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  const nextM = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return { prev, next: nextM > current ? null : nextM };
}
