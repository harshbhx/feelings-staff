import type { PunchForCalc } from '@fs/contracts';
import { monthDates, PayslipResult as PayslipSchema, weekday } from '@fs/contracts';
import { describe, expect, it } from 'vitest';
import { computeDay } from '../src/day';
import { frac } from '../src/money';
import { computePayslip, lateFines } from '../src/pay';
import { resolveSchedule } from '../src/schedule';
import { person as policy, RULES as TIME_RULES, TPL } from './fixtures';
import {
  absent,
  adj,
  advance,
  amount,
  approve,
  dr,
  formula,
  holiday,
  input,
  meena,
  monthOf,
  NOV,
  OCT,
  oct,
  person,
  RULES,
  slip,
  weekOff,
} from './pay-fixtures';

const check = (r: ReturnType<typeof slip>) => {
  expect(() => PayslipSchema.parse(r)).not.toThrow();
  return r;
};

describe('PRD 7.15 worked examples, to the paisa', () => {
  it('example 1: two absent days', () => {
    const r = check(slip({ days: oct([absent('2026-10-07'), absent('2026-10-08')]) }));
    expect(amount(r, 'salary')).toBe(1_500_000);
    expect(amount(r, 'lop')).toBe(-96_774);
    expect(r).toMatchObject({
      grossPaise: 1_500_000,
      deductionsPaise: 96_774,
      netBeforeRoundingPaise: 1_403_226,
      roundingPaise: -26,
      netPaise: 1_403_200,
      dailyRatePaise: 48_387,
    });
    expect(formula(r, 'lop')).toBe('₹15,000 ÷ 31 days × 2 days');
  });

  it.each([
    { u: 15, paise: 1_344 },
    { u: 2, paise: 179 },
    { u: 0, paise: 0 },
    { u: 20, paise: 1_792 },
  ])('example 2: $u billable minutes cost $paise paise', ({ u, paise }) => {
    const r = slip({ days: oct([dr('2026-10-07', { undertimeMin: u, lateBillableMin: u })]) });
    expect(amount(r, 'undertime')).toBe(-paise);
  });

  it('example 2: the month total is rounded once (37 min -> ₹33.15)', () => {
    const days = oct([
      dr('2026-10-07', { undertimeMin: 15 }),
      dr('2026-10-08', { undertimeMin: 2 }),
      dr('2026-10-09', { undertimeMin: 0 }),
      dr('2026-10-13', { undertimeMin: 20 }),
    ]);
    expect(amount(slip({ days }), 'undertime')).toBe(-3_315);
  });

  it('example 3: a half day is 0.5 LOP; early 105 on a P day is ₹94.09', () => {
    expect(amount(slip({ days: oct([dr('2026-10-07', { status: 'H' })]) }), 'lop')).toBe(-24_194);
    const r = slip({ days: oct([dr('2026-10-07', { undertimeMin: 105, earlyBillableMin: 105 })]) });
    expect(amount(r, 'undertime')).toBe(-9_409);
    expect(r.earlyBillableMin).toBe(105);
  });

  it('example 4: 120 min of approved overtime at 2x is ₹215.05', () => {
    const r = slip({
      days: oct([dr('2026-10-07', { otCandidateMin: 120 })]),
      approvals: [approve('2026-10-07', 120, 120)],
    });
    expect(amount(r, 'overtime')).toBe(21_505);
    expect(formula(r, 'overtime')).toBe('₹483.87 × 2 × 120 min ÷ 540');
  });

  it('example 5: 30 min overtime ₹53.76; 20 min undertime ₹17.92', () => {
    const r = slip({
      days: oct([dr('2026-10-07', { otCandidateMin: 30 }), dr('2026-10-08', { undertimeMin: 20 })]),
      approvals: [approve('2026-10-07', 30, 30)],
    });
    expect(amount(r, 'overtime')).toBe(5_376);
    expect(amount(r, 'undertime')).toBe(-1_792);
  });

  it('example 6: Sunday: 5 min of 180 is ₹13.44; 45 min overtime uses S_std (₹80.65)', () => {
    const sunday = { scheduledMin: 180, workedMin: 180, breakMin: 0 };
    const r = slip({
      days: oct([
        dr('2026-10-04', { ...sunday, undertimeMin: 5 }),
        dr('2026-10-11', { ...sunday, otCandidateMin: 45 }),
      ]),
      approvals: [approve('2026-10-11', 45, 45)],
    });
    expect(amount(r, 'undertime')).toBe(-1_344);
    expect(amount(r, 'overtime')).toBe(8_065);
    expect(formula(r, 'undertime')).toBe('₹483.87 × 5 min ÷ 180');
  });

  it('example 7: advance and the 50% cap', () => {
    const absents = ['02', '04', '05', '06', '07', '09', '11', '12', '13'].map((d) =>
      absent(`2026-11-${d}`),
    );
    const r = check(
      slip({
        person: person({}, NOV, 1_200_000),
        month: NOV,
        days: monthOf(NOV, { days: Object.fromEntries(absents.map((d) => [d.workDate, d])) }),
        advances: [advance(1, 600_000)],
      }),
    );
    expect(amount(r, 'lop')).toBe(-360_000);
    expect(amount(r, 'advance_recovery')).toBe(-240_000);
    expect(r.advanceRecoveries).toEqual([
      {
        advanceId: advance(1, 0).advanceId,
        duePaise: 600_000,
        recoveredPaise: 240_000,
        carriedPaise: 360_000,
      },
    ]);
    expect(r.carryOut.advances).toEqual([{ advanceId: advance(1, 0).advanceId, paise: 360_000 }]);
    expect(r).toMatchObject({ grossPaise: 1_200_000, netPaise: 600_000, roundingPaise: 0 });
    expect(r.warnings).toContainEqual({
      code: 'cap_carry',
      message: '₹3,600 of the advance moves to next month.',
      amountPaise: 360_000,
    });
  });

  it('example 8: joining on 12 Oct on a fixed-26 divisor', () => {
    const r = check(
      slip({
        person: person({ joinDate: '2026-10-12', divisor: 'fixed26' }, OCT, 1_300_000),
        days: monthOf(OCT, { from: '2026-10-12', days: { '2026-10-14': absent('2026-10-14') } }),
      }),
    );
    expect(r).toMatchObject({ employedDays: 20, divisorDays: 26, dailyRatePaise: 50_000 });
    expect(amount(r, 'salary')).toBe(838_710);
    expect(formula(r, 'salary')).toBe('₹13,000 × 20/31 days');
    expect(amount(r, 'lop')).toBe(-50_000);
    expect(r).toMatchObject({
      netBeforeRoundingPaise: 788_710,
      netPaise: 788_700,
      roundingPaise: -10,
    });
    expect(r.counts.NE).toBe(11);
  });

  it('example 9: working the weekly off, comp-off by default or extra pay at 2x total', () => {
    const days = oct([weekOff('2026-10-20', { workedMin: 510, offdayCredit: 1 })]);
    const compOff = slip({ days });
    expect(compOff.compOffEarned).toBe(1);
    expect(amount(compOff, 'offday_extra')).toBe(0);
    const extra = slip({ days, rules: { ...RULES, weekOffWorked: 'extra_pay' } });
    expect(amount(extra, 'offday_extra')).toBe(48_387);
    expect(formula(extra, 'offday_extra')).toBe('₹483.87 × (2 − 1) × 1 day');
    expect(extra.compOffEarned).toBe(0);
  });

  it('example 10: daily-wage staff, paid holiday, unpaid week-offs', () => {
    const r = check(
      slip({
        person: meena(),
        days: oct([
          holiday('2026-10-02'),
          dr('2026-10-07', { status: 'H' }),
          dr('2026-10-08', { status: 'H' }),
        ]),
      }),
    );
    expect(r.counts).toMatchObject({ P: 24, H: 2, HO: 1, WO: 4, paidDays: 26 });
    expect(amount(r, 'basic')).toBe(1_430_000);
    expect(formula(r, 'basic')).toBe('₹550 a day × 26 days');
    expect(r).toMatchObject({ salaryType: 'daily', netPaise: 1_430_000 });
  });

  const example11 = {
    salary: 1_500_000,
    overtime: 26_882,
    incentive: 50_000,
    lop: -72_581,
    undertime: -5_556,
    advance: -300_000,
  };
  const expectExample11 = (r: ReturnType<typeof slip>) => {
    check(r);
    expect(amount(r, 'salary')).toBe(example11.salary);
    expect(amount(r, 'overtime')).toBe(example11.overtime);
    expect(amount(r, 'incentive')).toBe(example11.incentive);
    expect(amount(r, 'lop')).toBe(example11.lop);
    expect(amount(r, 'undertime')).toBe(example11.undertime);
    expect(amount(r, 'advance_recovery')).toBe(example11.advance);
    expect(r).toMatchObject({
      grossPaise: 1_576_882,
      deductionsPaise: 378_137,
      netBeforeRoundingPaise: 1_198_745,
      roundingPaise: -45,
      netPaise: 1_198_700,
      lateBillableMin: 52,
      otApprovedMin: 150,
      otPendingMin: 0,
    });
    expect(r.counts).toMatchObject({ A: 1, H: 1, lopDays: 1.5, paidDays: 29.5 });
    expect(formula(r, 'lop')).toBe('₹15,000 ÷ 31 days × 1.5 days');
    expect(formula(r, 'overtime')).toBe('₹483.87 × 2 × 150 min ÷ 540');
    expect(formula(r, 'undertime')).toBe('₹483.87 × 47 min ÷ 540 + ₹483.87 × 5 min ÷ 180');
  };
  const extras11 = {
    approvals: [approve('2026-10-14', 150, 150)],
    adjustments: [adj(1, 'incentive', 50_000, 'Bridal season incentive')],
    advances: [advance(1, 300_000)],
  };

  it('example 11: a full month on one payslip (day results)', () => {
    const days = oct([
      absent('2026-10-01'),
      dr('2026-10-02', { status: 'H', workedMin: 300 }),
      dr('2026-10-07', { undertimeMin: 15, lateBillableMin: 15 }),
      dr('2026-10-08', { undertimeMin: 20, lateBillableMin: 20 }),
      dr('2026-10-09', { undertimeMin: 12, lateBillableMin: 12 }),
      dr('2026-10-11', { scheduledMin: 180, workedMin: 175, undertimeMin: 5, lateBillableMin: 5 }),
      dr('2026-10-14', { otCandidateMin: 150 }),
    ]);
    expectExample11(slip({ days, ...extras11 }));
  });

  it('example 11 end to end: punches -> resolveSchedule -> computeDay -> computePayslip', () => {
    const priya = policy();
    const sundays = monthDates(OCT).filter((d) => weekday(d) === 0);
    const calendar = {
      holidays: [],
      rosterOverrides: sundays.map((date) => ({
        date,
        kind: 'template' as const,
        template: TPL.sunday,
      })),
    };
    const script: Record<string, string[]> = {
      '2026-10-01': [],
      '2026-10-02': ['10:00', '15:00'],
      '2026-10-07': ['10:25', '20:00'],
      '2026-10-08': ['10:30', '20:00'],
      '2026-10-09': ['10:22', '20:00'],
      '2026-10-11': ['10:15', '13:00'],
      '2026-10-14': ['10:00', '22:30'],
    };
    let n = 0;
    const days = monthDates(OCT).map((date) => {
      const schedule = resolveSchedule(priya, date, calendar);
      const first = schedule.segments[0];
      const lastSeg = schedule.segments[schedule.segments.length - 1];
      const at = (hhmm: string) => {
        const [h, m] = hhmm.split(':').map(Number) as [number, number];
        return Date.UTC(2026, 9, Number(date.slice(8)), h, m) - 330 * 60_000;
      };
      const times = script[date];
      const pair: Array<[PunchForCalc['kind'], number]> =
        times !== undefined
          ? times.map((t, i): [PunchForCalc['kind'], number] => [i % 2 === 0 ? 'in' : 'out', at(t)])
          : first !== undefined && lastSeg !== undefined
            ? [
                ['in', first.startTs],
                ['out', lastSeg.endTs],
              ]
            : [];
      const punches: PunchForCalc[] = pair.map(([kind, ts]) => ({
        id: `01J${String(++n).padStart(23, '0')}`,
        kind,
        effectiveTs: ts,
        status: 'accepted',
        source: 'online',
        offsiteDutyId: null,
      }));
      return computeDay({
        schedule,
        punches,
        preapprovals: [],
        leave: null,
        rules: TIME_RULES,
        override: null,
      });
    });
    const statuses = days.map((d) => d.status);
    expect(statuses.filter((s) => s === 'A')).toHaveLength(1);
    expect(statuses.filter((s) => s === 'H')).toHaveLength(1);
    expect(statuses.filter((s) => s === 'WO')).toHaveLength(4);
    expect(days.find((d) => d.workDate === '2026-10-14')?.otCandidateMin).toBe(150);
    expectExample11(computePayslip(input({ days, ...extras11 })));
  });

  it('example 12: fines on, 4 lates -> 1 fine of ₹241.94 inside the 3% cap', () => {
    const lates = ['07', '08', '09', '12'].map((d) =>
      dr(`2026-10-${d}`, { lateBillableMin: 5, undertimeMin: 5 }),
    );
    const f = lateFines(lates, 3, frac(1_500_000, 31));
    expect(f).toEqual({ lates: 4, count: 1, finePaise: 24_194 });
    const r = slip({
      days: oct(lates),
      fines: [
        { id: '01J0000000000000000000F001', amountPaise: f.finePaise, fineDate: '2026-10-31' },
      ],
    });
    expect(amount(r, 'fine')).toBe(-24_194);
    expect(r.carryOut.fines).toEqual([]);
  });
});
