import type { TodayBoard } from '@fs/contracts';
import { fixtures, variants } from '@fs/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import {
  BOARD_VIEWS,
  boardMode,
  boardModel,
  dayProgress,
  heroParts,
  liveWorkedMin,
  sections,
} from './today-model';

const board = fixtures.ownerToday as TodayBoard;
const holiday = variants.ownerToday?.holiday as TodayBoard;
const before = variants.ownerToday?.['before-first-shift'] as TodayBoard;

describe('Today board model (O-03)', () => {
  it('O-03.1 the three views hold everyone on the board, once', () => {
    const m = boardModel(board);
    expect(BOARD_VIEWS).toEqual(['in', 'notIn', 'away']);
    expect(m.viewCounts.in).toBe(board.in.length + board.out.length);
    expect(m.viewCounts.notIn).toBe(board.notIn.length);
    expect(m.viewCounts.away).toBe(board.away.length);
    expect(m.viewCounts.in).toBe(board.counters.present);
  });

  it('O-03.1 not in yet splits people already due from those due later', () => {
    const s = sections(board);
    expect(s.notIn.every((r) => r.state === 'not_in_yet')).toBe(true);
    expect(s.dueLater.every((r) => r.state === 'due_later')).toBe(true);
    expect(s.notIn.length + s.dueLater.length).toBe(board.notIn.length);
  });

  it('the hero sentence keeps the parts that are not zero, late agreeing with the strip', () => {
    const p = dayProgress(board);
    const parts = heroParts(board, p);
    expect(parts.map((x) => x.key)).toEqual(['late', 'notInYet', 'dueLater', 'onLeave', 'off']);
    expect(parts.find((x) => x.key === 'late')?.count).toBe(p.late);
    expect(parts.find((x) => x.key === 'off')?.count).toBe(
      board.away.filter((r) => r.reason !== 'leave').length,
    );
    expect(parts.every((x) => x.count > 0)).toBe(true);
  });

  it('the hero sentence is empty when everyone due is in on time and nobody is away', () => {
    const calm: TodayBoard = {
      ...board,
      counters: { ...board.counters, late: 0, notInYet: 0, onLeave: 0, weekOff: 0, atVenue: 0 },
      in: board.in.map((r) => ({ ...r, lateMin: 0 })),
      notIn: [],
      away: [],
    };
    expect(heroParts(calm, dayProgress(calm))).toEqual([]);
  });

  it('shows the closed message on a holiday and the before-first-shift message early', () => {
    expect(boardMode(holiday)).toEqual({ kind: 'closed', holidayName: 'Dussehra' });
    expect(boardMode(before)).toEqual({ kind: 'before', firstShiftStart: '10:00' });
    expect(boardMode(board)).toEqual({ kind: 'live' });
  });

  it('live hours grow with the clock for people still in', () => {
    const row = board.in[0];
    if (!row) throw new Error('fixture has people in');
    expect(liveWorkedMin(row, board.updatedAt, board.updatedAt + 5 * 60_000)).toBe(
      row.workedMin + 5,
    );
  });

  it('O-03.1 the progress strip counts who is working today, late split from on time', () => {
    const p = dayProgress(board);
    expect(p.inCount).toBe(board.counters.present);
    expect(p.onTime + p.late).toBe(p.inCount);
    const dueLater = board.notIn.filter((r) => r.state === 'due_later').length;
    expect(p.late).toBe(Math.min(board.counters.late, board.counters.present));
    expect(p.onTime).toBe(board.counters.present - p.late);
    expect(p.notInYet).toBe(board.counters.notInYet - dueLater);
    expect(p.total).toBe(board.counters.present + board.counters.notInYet);
    expect(p.total).toBe(p.inCount + p.notInYet + p.dueLater);
    expect(p.dueLater).toBe(board.notIn.filter((r) => r.state === 'due_later').length);
  });
});
