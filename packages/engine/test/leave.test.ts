import { describe, expect, it } from 'vitest';
import {
  blackoutHits,
  compOffExpiresOn,
  compOffState,
  leaveDays,
  leaveUsableFrom,
  quotaForYear,
  roundHalf,
  sandwichDates,
  splitPaidUnpaid,
} from '../src/leave';
import { frac } from '../src/money';
import { absent, dr, weekOff } from './pay-fixtures';

describe('leave (PRD 7.8, 14.2 leave)', () => {
  it.each([
    { join: '2025-06-01', year: 2026, days: 7, why: 'joined in an earlier year' },
    { join: '2026-01-05', year: 2026, days: 7, why: 'joined in January' },
    { join: '2026-07-01', year: 2026, days: 3.5, why: '7 x 6/12' },
    { join: '2026-09-15', year: 2026, days: 2.5, why: '7 x 4/12 = 2.33' },
    { join: '2026-10-12', year: 2026, days: 2, why: '7 x 3/12 = 1.75, a tie rounds up' },
    { join: '2026-11-20', year: 2026, days: 1, why: '7 x 2/12 = 1.17' },
    { join: '2027-01-01', year: 2026, days: 0, why: 'not joined yet' },
  ])('CL proration for joiners: $join -> $days ($why)', ({ join, year, days }) => {
    expect(quotaForYear(7, join, year)).toBe(days);
  });

  it('round_half rounds to the nearest 0.5, ties up', () => {
    expect(roundHalf(frac(5, 4))).toBe(1.5);
    expect(roundHalf(frac(124, 100))).toBe(1);
  });

  it('usable after 90 days of service', () => {
    expect(leaveUsableFrom('2026-07-01', 90)).toBe('2026-09-29');
  });

  it('example 9: a comp-off earned on 20 Oct expires on 19 Dec', () => {
    expect(compOffExpiresOn('2026-10-20', 60)).toBe('2026-12-19');
  });

  it('comp-off is used oldest first and expires after 60 days', () => {
    const entries = [
      { date: '2026-11-10', kind: 'debit' as const, days: 1 },
      { date: '2026-10-20', kind: 'credit' as const, days: 1 },
      { date: '2026-11-05', kind: 'credit' as const, days: 0.5 },
    ];
    expect(compOffState(entries, '2026-11-10', 60)).toEqual({
      lots: [{ earnedOn: '2026-11-05', expiresOn: '2027-01-04', remaining: 0.5 }],
      balance: 0.5,
      expired: [],
      overdrawn: 0,
    });
    expect(compOffState(entries, '2027-01-05', 60)).toMatchObject({
      balance: 0,
      expired: [{ earnedOn: '2026-11-05', remaining: 0.5 }],
    });
  });

  it('comp-off past its expiry cannot be used; a same-day credit is used first', () => {
    const state = compOffState(
      [
        { date: '2026-08-01', kind: 'credit', days: 1 },
        { date: '2026-10-01', kind: 'debit', days: 1 },
        { date: '2026-10-01', kind: 'credit', days: 0.5 },
      ],
      '2026-10-01',
      60,
    );
    expect(state).toMatchObject({ balance: 0, overdrawn: 0.5 });
    expect(state.expired).toEqual([
      { earnedOn: '2026-08-01', expiresOn: '2026-09-30', remaining: 1 },
    ]);
  });

  it.each([
    {
      name: 'sandwich: an off day between two absent days',
      days: [absent('2026-10-05'), weekOff('2026-10-06'), absent('2026-10-07')],
      out: ['2026-10-06'],
    },
    {
      name: 'sandwich: several off days between LOP and absent, given out of order',
      days: [
        absent('2026-10-08'),
        weekOff('2026-10-06'),
        dr('2026-10-05', { status: 'LOP', workedMin: 0, leaveCode: 'LOP' }),
        dr('2026-10-07', { dayType: 'HO', status: 'HO', scheduledMin: 0, workedMin: 0 }),
      ],
      out: ['2026-10-06', '2026-10-07'],
    },
    {
      name: 'no sandwich when the day after is present',
      days: [absent('2026-10-05'), weekOff('2026-10-06'), dr('2026-10-07')],
      out: [],
    },
    {
      name: 'no sandwich when the off day was worked',
      days: [absent('2026-10-05'), weekOff('2026-10-06', { workedMin: 300 }), absent('2026-10-07')],
      out: [],
    },
    {
      name: 'no sandwich at the start of the month or after a half day',
      days: [
        weekOff('2026-10-01'),
        absent('2026-10-02'),
        dr('2026-10-03', { status: 'H' }),
        weekOff('2026-10-04'),
        absent('2026-10-05'),
      ],
      out: [],
    },
  ])('$name', ({ days, out }) => {
    expect(sandwichDates(days)).toEqual(out);
  });

  it('leave days count working days only; a half day is 0.5', () => {
    const days = [
      { dayType: 'work' },
      { dayType: 'WO' },
      { dayType: 'HO' },
      { dayType: 'work' },
    ] as const;
    expect(leaveDays(days, 'none')).toBe(2);
    expect(leaveDays([{ dayType: 'work' }], 'first')).toBe(0.5);
  });

  it.each([
    { requested: 3, balance: 2, paid: 2, unpaid: 1 },
    { requested: 3, balance: 2.7, paid: 2.5, unpaid: 0.5 },
    { requested: 3, balance: -1, paid: 0, unpaid: 3 },
    { requested: 1, balance: 5, paid: 1, unpaid: 0 },
  ])(
    'split paid/unpaid: $requested days with $balance left',
    ({ requested, balance, paid, unpaid }) => {
      expect(splitPaidUnpaid(requested, balance)).toEqual({ paid, unpaid });
    },
  );

  it('blackout days are flagged', () => {
    expect(blackoutHits(['2026-10-25', '2026-10-26'], ['2026-10-26', '2026-11-01'])).toEqual([
      '2026-10-26',
    ]);
  });
});
