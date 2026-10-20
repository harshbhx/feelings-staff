import type { TodayBoard } from '@fs/contracts';
import { fixtures, variants } from '@fs/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import {
  boardMode,
  boardModel,
  dayProgress,
  headlineParts,
  liveWorkedMin,
  sections,
} from './today-model';

const board = fixtures.ownerToday as TodayBoard;
const holiday = variants.ownerToday?.holiday as TodayBoard;
const before = variants.ownerToday?.['before-first-shift'] as TodayBoard;

describe('Today board model (O-03)', () => {
  it('O-03.1 counters come straight from the day data, in the PRD order', () => {
    const m = boardModel(board, null);
    expect(m.counters.map((c) => c.key)).toEqual([
      'present',
      'late',
      'notInYet',
      'onLeave',
      'weekOff',
      'atVenue',
    ]);
    expect(m.counters.find((c) => c.key === 'present')?.value).toBe(board.counters.present);
    expect(m.counters.find((c) => c.key === 'late')?.value).toBe(board.counters.late);
  });

  it('O-03.1 the late filter shows only people who came in late', () => {
    const s = sections(board, 'late');
    expect(s.in.length).toBeGreaterThan(0);
    expect(s.in.every((r) => r.lateMin > 0)).toBe(true);
    expect(s.notIn).toEqual([]);
    expect(s.away).toEqual([]);
  });

  it('O-03.1 not in yet splits people already due from those due later', () => {
    const s = sections(board, null);
    expect(s.notIn.every((r) => r.state === 'not_in_yet')).toBe(true);
    expect(s.dueLater.every((r) => r.state === 'due_later')).toBe(true);
    expect(s.notIn.length + s.dueLater.length).toBe(board.notIn.length);
  });

  it('O-03.1 leave and week-off filters pick the right away rows', () => {
    expect(sections(board, 'onLeave').away.every((r) => r.reason === 'leave')).toBe(true);
    expect(sections(board, 'weekOff').away.every((r) => r.reason === 'week_off')).toBe(true);
  });

  it('shows the closed message on a holiday and the before-first-shift message early', () => {
    expect(boardMode(holiday)).toEqual({ kind: 'closed', holidayName: 'Dussehra' });
    expect(boardMode(before)).toEqual({ kind: 'before', firstShiftStart: '10:00' });
    expect(boardMode(board)).toEqual({ kind: 'live' });
  });

  it('the headline keeps the in count and drops zero parts', () => {
    const parts = headlineParts(before);
    expect(parts[0]?.key).toBe('owner:today.headline.in');
    expect(parts.some((p) => p.key === 'owner:today.headline.late')).toBe(false);
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
    expect(p.everyone).toBe(p.inCount + board.notIn.length + board.away.length);
  });
});
