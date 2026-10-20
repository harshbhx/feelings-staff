import type { RegisterView } from '@fs/contracts';
import { fixtures } from '@fs/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import {
  cellDetail,
  cellModel,
  monthNav,
  monthTotals,
  stripIndexFor,
  TOTAL_COLUMNS,
  totalValue,
  weekStrips,
} from './register-model';

const view = fixtures.ownerRegister as RegisterView;
const row = view.rows[0];
if (!row) throw new Error('register fixture has rows');

describe('Register model (O-05)', () => {
  it('O-05.1 every staff x day cell has a letter, a status (colour + icon) and a word (future days blank)', () => {
    for (const r of view.rows) {
      expect(r.cells).toHaveLength(view.dates.length);
      r.cells.forEach((c, i) => {
        const m = cellModel(view.dates[i] ?? '', c);
        if (c.future) expect(m.meta).toBeNull();
        else {
          expect(m.meta?.letter).toBeTruthy();
          expect(m.meta?.chip).toBeTruthy();
          expect(m.meta?.labelKey).toMatch(/^owner:status\./);
        }
      });
    }
  });

  it('O-05.2 row totals are the API totals (the engine), not recounted here', () => {
    expect(TOTAL_COLUMNS.map((c) => totalValue(row, c))).toEqual([
      row.totals.present,
      row.totals.half,
      row.totals.absent,
      row.totals.leave,
      row.totals.lateMin,
      Math.round((row.totals.otApprovedMin / 60) * 10) / 10,
      row.totals.lop,
    ]);
  });

  it('cell tooltip reads like the PRD: late minutes, in and out times', () => {
    const parts = cellDetail({
      status: 'P',
      dayType: 'work',
      tags: ['late'],
      leaveCode: null,
      lateMin: 25,
      inTs: Date.parse('2026-10-14T10:25:00+05:30'),
      outTs: Date.parse('2026-10-14T20:04:00+05:30'),
      future: false,
    });
    expect(parts).toEqual([
      { key: 'owner:register.tip.late', values: { min: '25' } },
      { key: 'owner:register.tip.in', values: { time: '10:25' } },
      { key: 'owner:register.tip.out', values: { time: '20:04' } },
    ]);
  });

  it('phone strips are Monday-first weeks covering the month exactly once', () => {
    const strips = weekStrips(view, row);
    const dates = strips.flatMap((s) => s.days.filter((d) => d !== null).map((d) => d?.date));
    expect(dates).toEqual(view.dates);
    expect(strips.every((s) => s.days.length === 7)).toBe(true);
    // 1 Oct 2026 is a Thursday: the first strip starts with three empty slots.
    expect(strips[0]?.days.slice(0, 3)).toEqual([null, null, null]);
    expect(stripIndexFor(strips, '2026-10-19')).toBe(3);
  });

  it('cannot page past the current month', () => {
    expect(monthNav('2026-10', '2026-10')).toEqual({ prev: '2026-09', next: null });
    expect(monthNav('2026-09', '2026-10')).toEqual({ prev: '2026-08', next: '2026-10' });
  });

  it('O-05.1 the month summary adds every row, column by column', () => {
    const sum = monthTotals(view);
    for (const c of TOTAL_COLUMNS) {
      const expected = view.rows.reduce((n, r) => n + totalValue(r, c), 0);
      expect(sum[c]).toBeCloseTo(expected, 5);
    }
  });
});
