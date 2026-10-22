import { MonthView } from '@fs/contracts';
import { fixtures } from '@fs/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { calendarWeeks, chipStatusOf, lateMark, monthNav } from './month-model';

const month = MonthView.parse(fixtures.meDays);

describe('My month (PRD 5.1, AC S-11)', () => {
  it('S-11.1 lays October 2026 out Monday first with every day once', () => {
    const weeks = calendarWeeks('2026-10', month.days, '2026-10-19');
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    // 1 Oct 2026 is a Thursday: three empty cells before it.
    expect(weeks[0]?.slice(0, 3)).toEqual([null, null, null]);
    expect(weeks[0]?.[3]?.date).toBe('2026-10-01');
    const dates = weeks.flat().filter((c) => c !== null);
    expect(dates).toHaveLength(31);
    expect(dates.find((c) => c.isToday)?.date).toBe('2026-10-19');
    expect(dates.filter((c) => c.isFuture)).toHaveLength(12);
  });

  it('S-11.1 each day shows the status stored for it', () => {
    const weeks = calendarWeeks('2026-10', month.days, '2026-10-19');
    const cell = (date: string) => weeks.flat().find((c) => c?.date === date);
    const chip = (date: string) => {
      const s = cell(date)?.summary;
      return s ? chipStatusOf(s) : null;
    };
    expect(chip('2026-10-01')).toBe('present');
    expect(chip('2026-10-02')).toBe('holiday');
    expect(chip('2026-10-06')).toBe('off');
    expect(chip('2026-10-12')).toBe('half');
    expect(chip('2026-10-14')).toBe('absent');
    expect(chip('2026-10-19')).toBe('present');
    expect(cell('2026-10-25')?.summary).toBeNull();
  });

  it('never moves past the current month', () => {
    expect(monthNav('2026-10', '2026-10')).toEqual({ prev: '2026-09', next: null });
    expect(monthNav('2026-01', '2026-10')).toEqual({ prev: '2025-12', next: '2026-02' });
  });

  it('a late present day shows minutes (+28, +1h from 60), other days show nothing', () => {
    const base = month.days.find((d) => d.status === 'P');
    expect(base).toBeDefined();
    if (!base) return;
    expect(lateMark({ ...base, lateMin: 28 })).toBe('+28');
    expect(lateMark({ ...base, lateMin: 59 })).toBe('+59');
    expect(lateMark({ ...base, lateMin: 60 })).toBe('+1h');
    expect(lateMark({ ...base, lateMin: 125 })).toBe('+2h');
    expect(lateMark({ ...base, lateMin: 0 })).toBeNull();
    expect(lateMark({ ...base, status: 'A', lateMin: 30 })).toBeNull();
  });
});
