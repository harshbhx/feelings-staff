/**
 * Today board view model (PRD 5.2 Today, O-03). Pure: takes the TodayBoard from the API and returns
 * what the screen draws. Readable in two seconds: one hero card ("8 of 9 in", the strip, one
 * sentence), then three views of the people (In, Not in yet, Away; UI redesign Fix 3).
 */
import type { TodayBoard } from '@fs/contracts';

export type BoardInRow = TodayBoard['in'][number];
export type BoardNotInRow = TodayBoard['notIn'][number];
export type BoardAwayRow = TodayBoard['away'][number];

export type BoardMode =
  /** Salon closed for a holiday. */
  | { kind: 'closed'; holidayName: string }
  /** Nobody is due yet (before the first shift). */
  | { kind: 'before'; firstShiftStart: string | null }
  | { kind: 'live' };

export interface BoardSections {
  in: BoardInRow[];
  /** Due now and not in (shift started). */
  notIn: BoardNotInRow[];
  /** Due later today (shift not started yet). */
  dueLater: BoardNotInRow[];
  out: BoardInRow[];
  away: BoardAwayRow[];
}

/** The three views of the segmented control on phones; on a wide screen all three show at once. */
export type BoardView = 'in' | 'notIn' | 'away';

export const BOARD_VIEWS: readonly BoardView[] = ['in', 'notIn', 'away'];

export interface BoardModel {
  mode: BoardMode;
  sections: BoardSections;
  /** People in each view, for the segment counts. */
  viewCounts: Record<BoardView, number>;
}

export function boardMode(board: TodayBoard): BoardMode {
  if (board.closed) return { kind: 'closed', holidayName: board.closed.holidayName };
  const anyoneDue = board.notIn.some((r) => r.state === 'not_in_yet');
  if (board.in.length === 0 && board.out.length === 0 && !anyoneDue)
    return { kind: 'before', firstShiftStart: board.firstShiftStart };
  return { kind: 'live' };
}

export function sections(board: TodayBoard): BoardSections {
  return {
    in: board.in,
    notIn: board.notIn.filter((r) => r.state === 'not_in_yet'),
    dueLater: board.notIn.filter((r) => r.state === 'due_later'),
    out: board.out,
    away: board.away,
  };
}

/** In: still in and checked out. Not in yet: due now and due later. Away: leave, week off, holiday. */
export function viewCounts(s: BoardSections): Record<BoardView, number> {
  return {
    in: s.in.length + s.out.length,
    notIn: s.notIn.length + s.dueLater.length,
    away: s.away.length,
  };
}

export function boardModel(board: TodayBoard): BoardModel {
  const s = sections(board);
  return { mode: boardMode(board), sections: s, viewCounts: viewCounts(s) };
}

/**
 * The hero's one sentence ("3 late, 1 not in yet, 1 due later, 1 on leave, 1 off today"), only the
 * parts that are not zero, in this order. Late is the strip's late count, so the sentence and the
 * strip agree; the others count the rows the views list.
 */
export function heroParts(
  board: TodayBoard,
  p: DayProgress,
): { key: 'late' | 'notInYet' | 'dueLater' | 'atVenue' | 'onLeave' | 'off'; count: number }[] {
  const s = sections(board);
  const parts = [
    { key: 'late' as const, count: p.late },
    { key: 'notInYet' as const, count: s.notIn.length },
    { key: 'dueLater' as const, count: s.dueLater.length },
    { key: 'atVenue' as const, count: board.counters.atVenue },
    { key: 'onLeave' as const, count: s.away.filter((r) => r.reason === 'leave').length },
    { key: 'off' as const, count: s.away.filter((r) => r.reason !== 'leave').length },
  ];
  return parts.filter((x) => x.count > 0);
}

/** Minutes since a check-in for rows that are still in, at the client's clock (live hours). */
export function liveWorkedMin(row: BoardInRow, updatedAt: number, now: number): number {
  if (row.outTs !== null) return row.workedMin;
  const drift = Math.max(0, Math.floor((now - updatedAt) / 60_000));
  return row.workedMin + drift;
}

export interface DayProgress {
  /** Came in today (still in or checked out). */
  inCount: number;
  onTime: number;
  late: number;
  notInYet: number;
  dueLater: number;
  /** Working today: in + not in yet + due later. Leave and week off are not counted. */
  total: number;
}

/** "8 of 10 in" and its parts, for the hero's progress strip (WP-10, redesign Fix 3). */
export function dayProgress(board: TodayBoard): DayProgress {
  const c = board.counters;
  const dueLater = board.notIn.filter((r) => r.state === 'due_later').length;
  const late = Math.min(c.late, c.present);
  // `counters.notInYet` counts every `notIn` row, due-later people included: split them out once.
  const notInYet = Math.max(0, c.notInYet - dueLater);
  return {
    inCount: c.present,
    onTime: c.present - late,
    late,
    notInYet,
    dueLater,
    total: c.present + notInYet + dueLater,
  };
}
