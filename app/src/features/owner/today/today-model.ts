/**
 * Today board view model (PRD 5.2 Today, O-03). Pure: takes the TodayBoard from the API and the
 * chosen counter filter, returns what the screen draws. Readable in two seconds: one headline,
 * counters that filter, then Who's in / Not in yet / Checked out / Away.
 */
import type { TodayBoard } from '@fs/contracts';

export type CounterKey = 'present' | 'late' | 'notInYet' | 'onLeave' | 'weekOff' | 'atVenue';

export const COUNTER_ORDER: readonly CounterKey[] = [
  'present',
  'late',
  'notInYet',
  'onLeave',
  'weekOff',
  'atVenue',
];

export type BoardInRow = TodayBoard['in'][number];
export type BoardNotInRow = TodayBoard['notIn'][number];
export type BoardAwayRow = TodayBoard['away'][number];

export type BoardMode =
  /** Salon closed for a holiday. */
  | { kind: 'closed'; holidayName: string }
  /** Nobody is due yet (before the first shift). */
  | { kind: 'before'; firstShiftStart: string | null }
  | { kind: 'live' };

export interface Counter {
  key: CounterKey;
  value: number;
}

export interface BoardSections {
  in: BoardInRow[];
  /** Due now and not in (shift started). */
  notIn: BoardNotInRow[];
  /** Due later today (shift not started yet). */
  dueLater: BoardNotInRow[];
  out: BoardInRow[];
  away: BoardAwayRow[];
}

export interface BoardModel {
  mode: BoardMode;
  counters: Counter[];
  sections: BoardSections;
  /** Rows hidden by the current filter, so the screen can say "Showing 3 of 11". */
  filtered: boolean;
}

export function boardMode(board: TodayBoard): BoardMode {
  if (board.closed) return { kind: 'closed', holidayName: board.closed.holidayName };
  const anyoneDue = board.notIn.some((r) => r.state === 'not_in_yet');
  if (board.in.length === 0 && board.out.length === 0 && !anyoneDue)
    return { kind: 'before', firstShiftStart: board.firstShiftStart };
  return { kind: 'live' };
}

export function counters(board: TodayBoard): Counter[] {
  return COUNTER_ORDER.map((key) => ({ key, value: board.counters[key] }));
}

const isVenue = (r: BoardInRow) => r.place === 'venue';

/** Apply a counter filter (tap a counter to filter, tap again to clear). */
export function sections(board: TodayBoard, filter: CounterKey | null): BoardSections {
  const all: BoardSections = {
    in: board.in,
    notIn: board.notIn.filter((r) => r.state === 'not_in_yet'),
    dueLater: board.notIn.filter((r) => r.state === 'due_later'),
    out: board.out,
    away: board.away,
  };
  const none: BoardSections = { in: [], notIn: [], dueLater: [], out: [], away: [] };
  switch (filter) {
    case null:
      return all;
    case 'present':
      return { ...none, in: all.in, out: all.out };
    case 'late':
      return {
        ...none,
        in: all.in.filter((r) => r.lateMin > 0),
        out: all.out.filter((r) => r.lateMin > 0),
      };
    case 'notInYet':
      return { ...none, notIn: all.notIn };
    case 'onLeave':
      return { ...none, away: all.away.filter((r) => r.reason === 'leave') };
    case 'weekOff':
      return { ...none, away: all.away.filter((r) => r.reason === 'week_off') };
    case 'atVenue':
      return { ...none, in: all.in.filter(isVenue), out: all.out.filter(isVenue) };
  }
}

export function boardModel(board: TodayBoard, filter: CounterKey | null): BoardModel {
  return {
    mode: boardMode(board),
    counters: counters(board),
    sections: sections(board, filter),
    filtered: filter !== null,
  };
}

/** The 2-second line: "8 in · 3 late · 1 not in yet", only the parts that are not zero. */
export function headlineParts(board: TodayBoard): { key: string; count: number }[] {
  const c = board.counters;
  const parts = [
    { key: 'owner:today.headline.in', count: c.present },
    { key: 'owner:today.headline.late', count: c.late },
    { key: 'owner:today.headline.notInYet', count: c.notInYet },
    { key: 'owner:today.headline.onLeave', count: c.onLeave },
    { key: 'owner:today.headline.atVenue', count: c.atVenue },
  ];
  const shown = parts.filter((p, i) => i === 0 || p.count > 0);
  return shown;
}

/** Minutes since a check-in for rows that are still in, at the client's clock (live hours). */
export function liveWorkedMin(row: BoardInRow, updatedAt: number, now: number): number {
  if (row.outTs !== null) return row.workedMin;
  const drift = Math.max(0, Math.floor((now - updatedAt) / 60_000));
  return row.workedMin + drift;
}
