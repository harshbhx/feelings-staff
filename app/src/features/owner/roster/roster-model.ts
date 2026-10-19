/**
 * Roster view model (PRD 5.2 Roster, O-08): week grid staff x 7 days, swap week-offs, weekly hours
 * with the 48 h warning, and the changes the API needs (a swap is two changes).
 */
import type { RosterCell, RosterChange, RosterView } from '@fs/contracts';
import { addDays, isoWeekDates, isoWeekOf } from '@fs/contracts';

export type RosterRow = RosterView['rows'][number];

export function weekNav(week: string): { prev: string; next: string } {
  const [monday] = isoWeekDates(week) as [string, ...string[]];
  return { prev: isoWeekOf(addDays(monday, -7)), next: isoWeekOf(addDays(monday, 7)) };
}

/** Days that can be swapped with a week-off: scheduled work days, not holidays or leave. */
export function swappable(cell: RosterCell): boolean {
  return cell.kind === 'template' && cell.duties.length === 0;
}

export function isWeekOff(cell: RosterCell): boolean {
  return cell.kind === 'WO';
}

/**
 * Swap a week-off with a work day in the same row: the week-off day takes the work day's template,
 * the work day becomes the week-off (PRD 5.2 "Swap with…").
 */
export function swapChanges(
  row: RosterRow,
  weekOffDate: string,
  workDate: string,
  note?: string,
): RosterChange[] {
  const off = row.cells.find((c) => c.date === weekOffDate);
  const work = row.cells.find((c) => c.date === workDate);
  if (!off || !work) throw new Error('Both days must be in this week');
  if (!isWeekOff(off)) throw new Error('The first day must be a week-off');
  if (!swappable(work) || !work.templateId) throw new Error('The second day must be a work day');
  const extra = note ? { note } : {};
  return [
    {
      userId: row.user.id,
      date: weekOffDate,
      kind: 'template',
      templateId: work.templateId,
      ...extra,
    },
    { userId: row.user.id, date: workDate, kind: 'week_off', ...extra },
  ];
}

/** Candidate days to swap a week-off with, in week order. */
export function swapTargets(row: RosterRow): RosterCell[] {
  return row.cells.filter(swappable);
}

/** Change one cell to a template, a week-off or no shift. */
export function cellChange(
  row: RosterRow,
  date: string,
  to:
    | { kind: 'template'; templateId: string }
    | { kind: 'week_off' }
    | { kind: 'no_shift' }
    | { kind: 'clear' },
): RosterChange {
  return to.kind === 'template'
    ? { userId: row.user.id, date, kind: 'template', templateId: to.templateId }
    : { userId: row.user.id, date, kind: to.kind };
}

/** Weekly hours as a number for "52 h this week, over 48". */
export function weeklyHours(row: RosterRow): number {
  return Math.round((row.scheduledMin / 60) * 10) / 10;
}

/** Short label for a cell: template name, WO, HO, L, or a venue. */
export function cellLabel(cell: RosterCell): { kind: RosterCell['kind']; text: string | null } {
  return { kind: cell.kind, text: cell.templateName };
}
