import { HolidayCreate } from '@fs/contracts';
import { describe, expect, it } from 'vitest';
import { HOLIDAYS_IN_GJ } from './holidays-in';
import { HOLIDAYS_2027, SEED_HOLIDAYS } from './index';

describe('generated India holiday suggestions', () => {
  it('every row passes the HolidayCreate schema', () => {
    for (const h of HOLIDAYS_IN_GJ) {
      const parsed = HolidayCreate.safeParse({ ...h, paid: true, workedComp: 'extra_pay' });
      expect(parsed.success, `${h.date} ${h.name}`).toBe(true);
    }
  });

  it('has no duplicate dates and covers 2026 and 2027', () => {
    const dates = HOLIDAYS_IN_GJ.map((h) => h.date);
    expect(new Set(dates).size).toBe(dates.length);
    expect(dates.some((d) => d.startsWith('2026-'))).toBe(true);
    expect(dates.some((d) => d.startsWith('2027-'))).toBe(true);
  });

  it('every real calendar date is valid', () => {
    for (const { date } of HOLIDAYS_IN_GJ) {
      expect(new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10)).toBe(date);
    }
  });

  it('the seeded list has unique dates (holidays_org_date index) and includes 2027', () => {
    const dates = SEED_HOLIDAYS.map((h) => h.date);
    expect(new Set(dates).size).toBe(dates.length);
    // The 2026 list is hand-written (8 rows, lunar festivals included), 2027 is generated (9).
    expect(SEED_HOLIDAYS.filter((h) => h.date.startsWith('2026-'))).toHaveLength(8);
    expect(SEED_HOLIDAYS.filter((h) => h.date.startsWith('2027-'))).toEqual(HOLIDAYS_2027);
    expect(HOLIDAYS_2027).toHaveLength(9);
    expect(SEED_HOLIDAYS).toHaveLength(17);
    for (const h of SEED_HOLIDAYS) {
      expect(HolidayCreate.safeParse({ ...h, paid: true }).success, `${h.date} ${h.name}`).toBe(
        true,
      );
    }
  });
});
