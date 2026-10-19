import type { DayResult, OtDecision, OtRate } from '@fs/contracts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { add, cmp, frac, mul, type Q, sum, toPaise, ZERO } from '../src/money';
import { computePayslip, type RatePart, type TimeDay, timeLines } from '../src/pay';
import { amount, approve, dr, input, oct, weekOff } from './pay-fixtures';

/** Priya: ₹15,000 on a calendar divisor in October (r_day = 15,000 / 31). */
const PRIYA: RatePart = { index: 0, monthly: true, rate: frac(1_500_000, 31) };
/** Meena: daily wage ₹550. */
const MEENA: RatePart = { index: 1, monthly: false, rate: frac(55_000) };
const X2: OtRate = { mode: 'multiplier', multiplier: 2 };

const td = (day: DayResult, over: Partial<Omit<TimeDay, 'day'>> = {}): TimeDay => ({
  day,
  status: day.status === 'OPEN' || day.status === 'NE' ? 'P' : day.status,
  part: PRIYA,
  offPaid: true,
  offMode: 'extra_pay',
  credits: false,
  ...over,
});

const run = (days: TimeDay[], approvals: OtDecision[] = [], otRate: OtRate = X2) =>
  timeLines({ days, approvals, otRate, stdMin: 540, offdayMultiplier: 2 });

describe('time lines stage (PRD 7.5-7.7, extracted from computePayslip)', () => {
  it('no days: no lines, no minutes, zero undertime', () => {
    const r = run([]);
    expect(r).toEqual({
      earnings: [],
      undertime: { amount: ZERO, formula: '' },
      lateBillableMin: 0,
      earlyBillableMin: 0,
      otApprovedMin: 0,
      otCreditMin: 0,
      otPendingMin: 0,
      compOffEarned: 0,
    });
  });

  it('example 2 and 6: undertime per S_day, exact and rounded once; billable minutes on P days only', () => {
    const r = run([
      td(dr('2026-10-07', { lateBillableMin: 15, undertimeMin: 15 })),
      td(dr('2026-10-13', { earlyBillableMin: 20, undertimeMin: 20 })),
      td(dr('2026-10-04', { scheduledMin: 180, lateBillableMin: 5, undertimeMin: 5 })),
      // A half day keeps its raw billable minutes but computeDay charges no undertime on it.
      td(dr('2026-10-08', { status: 'H', lateBillableMin: 30, undertimeMin: 0 })),
    ]);
    expect(r.lateBillableMin).toBe(20);
    expect(r.earlyBillableMin).toBe(20);
    // 483.87 × 35/540 + 483.87 × 5/180 = r_day × 50/540 = ₹44.80 (one rounding).
    expect(toPaise(r.undertime.amount)).toBe(4_480);
    expect(r.undertime.formula).toBe('₹483.87 × 35 min ÷ 540 + ₹483.87 × 5 min ÷ 180');
    expect(r.earnings).toEqual([]);
  });

  it('example 4: 120 approved minutes at 2x on S_std are ₹215.05', () => {
    const r = run(
      [td(dr('2026-10-07', { otCandidateMin: 120 }))],
      [approve('2026-10-07', 120, 120)],
    );
    expect(r.earnings).toEqual([
      { code: 'overtime', amountPaise: 21_505, formula: '₹483.87 × 2 × 120 min ÷ 540' },
    ]);
    expect(r).toMatchObject({ otApprovedMin: 120, otPendingMin: 0 });
  });

  it('pre-approved minutes are paid without a decision, auto rows are ignored, approvals cap at the candidate, undecided is pending', () => {
    const auto: OtDecision = {
      workDate: '2026-10-08',
      candidateMin: 15,
      approvedMin: 15,
      decision: 'auto',
    };
    const r = run(
      [
        td(dr('2026-10-08', { otPreapprovedMin: 30, otCandidateMin: 15 })),
        td(dr('2026-10-09', { otCandidateMin: 45 })),
        td(dr('2026-10-10', { otCandidateMin: 60 })),
        td(dr('2026-10-12', { otCandidateMin: 30 })),
      ],
      [auto, { ...approve('2026-10-10', 60, 60), approvedMin: 90 }, approve('2026-10-12', 30, 0)],
    );
    // 30 pre-approved + 60 approved (capped at the candidate); 15 + 45 undecided; 30 rejected.
    expect(r).toMatchObject({ otApprovedMin: 90, otPendingMin: 60 });
    expect(r.earnings[0]?.formula).toBe('₹483.87 × 2 × 90 min ÷ 540');
  });

  it('flat, comp-off and unpaid overtime modes', () => {
    const days = [td(dr('2026-10-07', { otPreapprovedMin: 480 }))];
    expect(run(days, [], { mode: 'flat', paisePerHour: 10_000 }).earnings).toEqual([
      { code: 'overtime', amountPaise: 80_000, formula: '₹100 an hour × 8 h' },
    ]);
    expect(run([], [], { mode: 'flat', paisePerHour: 10_000 }).earnings).toEqual([]);
    const comp = run(days, [], { mode: 'comp_off' });
    expect(comp).toMatchObject({ earnings: [], compOffEarned: 1, otApprovedMin: 480 });
    const unpaid = run(days, [], { mode: 'unpaid' });
    expect(unpaid).toMatchObject({ earnings: [], compOffEarned: 0, otApprovedMin: 480 });
  });

  it('example 9: off-day extra pays (mult − 1) when the day is paid anyway, mult when it is not; comp-off and both', () => {
    const r = run([
      td(weekOff('2026-10-20', { workedMin: 510, offdayCredit: 1 })),
      td(weekOff('2026-10-06', { workedMin: 300, offdayCredit: 0.5 }), {
        part: MEENA,
        offPaid: false,
        offMode: 'both',
      }),
      td(weekOff('2026-10-13', { workedMin: 510, offdayCredit: 1 }), { offMode: 'comp_off' }),
    ]);
    // 483.87 × (2 − 1) × 1 + 550 × 2 × 0.5 = ₹1,033.87.
    expect(r.earnings).toEqual([
      {
        code: 'offday_extra',
        amountPaise: 103_387,
        formula: '₹483.87 × (2 − 1) × 1 day + ₹550.00 × 2 × 0.5 days',
      },
    ]);
    expect(r.compOffEarned).toBe(1.5);
  });

  it('example 11: the stage gives the overtime line and the exact late/early before the clamp', () => {
    const days = oct([
      dr('2026-10-07', { undertimeMin: 15, lateBillableMin: 15 }),
      dr('2026-10-08', { undertimeMin: 20, lateBillableMin: 20 }),
      dr('2026-10-09', { undertimeMin: 12, lateBillableMin: 12 }),
      dr('2026-10-11', { scheduledMin: 180, workedMin: 175, undertimeMin: 5, lateBillableMin: 5 }),
      dr('2026-10-14', { otCandidateMin: 150 }),
    ]);
    const approvals = [approve('2026-10-14', 150, 150)];
    const r = run(
      days.filter((d) => d.status !== 'NE').map((d) => td(d)),
      approvals,
    );
    expect(r.earnings).toEqual([
      { code: 'overtime', amountPaise: 26_882, formula: '₹483.87 × 2 × 150 min ÷ 540' },
    ]);
    expect(toPaise(r.undertime.amount)).toBe(5_556);
    const slip = computePayslip(input({ days, approvals }));
    expect(amount(slip, 'overtime')).toBe(26_882);
    expect(amount(slip, 'undertime')).toBe(-5_556);
    expect(slip).toMatchObject({ lateBillableMin: r.lateBillableMin, otApprovedMin: 150 });
  });
});

describe('time lines property tests (PRD 14.2)', () => {
  const dates = Array.from({ length: 28 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);
  const day = fc.record({
    sDay: fc.constantFrom(540, 300, 180),
    ut: fc.integer({ min: 0, max: 120 }),
    pre: fc.integer({ min: 0, max: 120 }),
    cand: fc.integer({ min: 0, max: 240 }),
    decision: fc.option(fc.integer({ min: 0, max: 300 }), { nil: null }),
  });
  const scenario = fc.array(day, { minLength: 1, maxLength: 28 });
  type Row = { sDay: number; ut: number; pre: number; cand: number; decision: number | null };
  const build = (s: Row[]) =>
    s.map((x, i) => {
      const date = dates[i] as string;
      const d = dr(date, {
        scheduledMin: x.sDay,
        undertimeMin: x.ut,
        otPreapprovedMin: x.pre,
        otCandidateMin: x.cand,
      });
      const a: OtDecision | null =
        x.decision === null
          ? null
          : { workDate: date, candidateMin: x.cand, approvedMin: x.decision, decision: 'partial' };
      return { d, a };
    });

  it('undertime is the exact sum of r_day × u / S_day; approved = pre + min(decision, candidate); nothing negative', () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const rows = build(s);
        const r = run(
          rows.map((x) => td(x.d)),
          rows.flatMap((x) => (x.a === null ? [] : [x.a])),
        );
        const exact: Q = sum(
          rows.map((x) => mul(PRIYA.rate, frac(x.d.undertimeMin, x.d.scheduledMin))),
        );
        expect(cmp(r.undertime.amount, exact)).toBe(0);
        const approved = rows.reduce(
          (n, x) =>
            n +
            x.d.otPreapprovedMin +
            (x.a === null ? 0 : Math.min(x.a.approvedMin, x.d.otCandidateMin)),
          0,
        );
        const pending = rows.reduce((n, x) => n + (x.a === null ? x.d.otCandidateMin : 0), 0);
        expect(r).toMatchObject({ otApprovedMin: approved, otPendingMin: pending });
        const ot = toPaise(mul(add(PRIYA.rate, PRIYA.rate), frac(approved, 540)));
        expect(r.earnings).toEqual(
          approved > 0 ? [expect.objectContaining({ code: 'overtime', amountPaise: ot })] : [],
        );
        expect(cmp(r.undertime.amount, ZERO)).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  it('the stage does not depend on the order of the days', () => {
    fc.assert(
      fc.property(scenario, fc.integer({ min: 0, max: 1000 }), (s, seed) => {
        const built = build(s);
        const rows = built.map((x) => td(x.d));
        const approvals = built.flatMap((x) => (x.a === null ? [] : [x.a]));
        const k = seed % rows.length;
        const shuffled = [...rows.slice(k), ...rows.slice(0, k)].reverse();
        const a = run(rows, approvals);
        const b = run(shuffled, [...approvals].reverse());
        expect(cmp(a.undertime.amount, b.undertime.amount)).toBe(0);
        expect(b.earnings.map((l) => l.amountPaise)).toEqual(a.earnings.map((l) => l.amountPaise));
        expect(b).toMatchObject({
          otApprovedMin: a.otApprovedMin,
          otPendingMin: a.otPendingMin,
          lateBillableMin: a.lateBillableMin,
        });
      }),
    );
  });
});
