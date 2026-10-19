/** PRD 14.2 "Monthly pay" and "Cap and advances" rows, table-driven, plus the pay property tests. */
import type { Adjustment, DayResult, OtRate, PayRules } from '@fs/contracts';
import { PayslipResult as PayslipSchema } from '@fs/contracts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { advanceInstalment, divisorDays, instalmentPlan, salaryParts } from '../src/pay';
import {
  absent,
  adj,
  advance,
  amount,
  approve,
  dr,
  formula,
  holiday,
  meena,
  NO_CARRY,
  NOV,
  oct,
  person,
  RULES,
  slip,
  weekOff,
} from './pay-fixtures';

const rules = (over: Partial<PayRules>): PayRules => ({ ...RULES, ...over });

describe('PRD 14.2 monthly pay', () => {
  it.each([
    { divisor: 'calendar', working: 27, days: 31, rate: 48_387 },
    { divisor: 'fixed30', working: 27, days: 30, rate: 50_000 },
    { divisor: 'fixed26', working: 27, days: 26, rate: 57_692 },
    { divisor: 'working', working: 27, days: 27, rate: 55_556 },
    { divisor: 'working', working: 0, days: 31, rate: 48_387 },
  ] as const)('each divisor: $divisor with W=$working uses $days days', (c) => {
    expect(divisorDays(c.divisor, '2026-10', c.working)).toBe(c.days);
    const r = slip({ person: person({ divisor: c.divisor, workingDays: c.working }) });
    expect(r.divisorDays).toBe(c.days);
    expect(r.dailyRatePaise).toBe(c.rate);
  });

  it('join mid-month prorates the salary by days employed', () => {
    const r = slip({
      person: person({ joinDate: '2026-10-12' }),
      days: oct([], { from: '2026-10-12' }),
    });
    expect(r.employedDays).toBe(20);
    expect(r.counts.NE).toBe(11);
    expect(amount(r, 'salary')).toBe(967_742);
    expect(formula(r, 'salary')).toBe('₹15,000 × 20/31 days');
  });

  it('exit mid-month prorates the salary by days employed', () => {
    const r = slip({
      person: person({ exitDate: '2026-10-20' }),
      days: oct([], { to: '2026-10-20' }),
    });
    expect(r.employedDays).toBe(20);
    expect(amount(r, 'salary')).toBe(967_742);
  });

  it('salary change mid-month gives one salary line per part', () => {
    const r = slip({
      person: person({
        salaryParts: [
          { from: '2026-10-01', to: '2026-10-15', type: 'monthly', amountPaise: 1_500_000 },
          { from: '2026-10-16', to: '2026-10-31', type: 'monthly', amountPaise: 1_800_000 },
        ],
      }),
      days: oct([absent('2026-10-05'), absent('2026-10-20')]),
    });
    const salary = r.lines.filter((l) => l.code === 'salary');
    expect(salary).toHaveLength(2);
    expect(salary[0]?.formula).toBe('₹15,000 × 15/31 days (1 Oct to 15 Oct)');
    expect(salary[1]?.formula).toBe('₹18,000 × 16/31 days (16 Oct to 31 Oct)');
    expect(formula(r, 'lop')).toBe('₹15,000 ÷ 31 days × 1 day + ₹18,000 ÷ 31 days × 1 day');
    expect(r.salaryType).toBe('monthly');
    expect(() => PayslipSchema.parse(r)).not.toThrow();
  });

  it('a part with a different salary type: daily after monthly', () => {
    const r = slip({
      person: person({
        salaryParts: [
          { from: '2026-10-01', to: '2026-10-09', type: 'monthly', amountPaise: 1_500_000 },
          { from: '2026-10-10', to: '2026-10-31', type: 'daily', amountPaise: 55_000 },
        ],
      }),
    });
    expect(r.salaryType).toBe('daily');
    expect(amount(r, 'salary')).toBeGreaterThan(0);
    expect(amount(r, 'basic')).toBeGreaterThan(0);
  });

  it('LOP clamps at the salary for the days employed', () => {
    const all = oct(
      Array.from({ length: 31 }, (_, i) => absent(`2026-10-${String(i + 1).padStart(2, '0')}`)),
    );
    const r = slip({ days: all });
    expect(amount(r, 'lop')).toBe(-1_500_000);
    expect(formula(r, 'lop')).toContain('no more than the salary for days employed');
    expect(r.netPaise).toBe(0);
  });

  it('LOP weights: unpaid leave is a full day, a paid half day is half, OPEN counts as present', () => {
    const r = slip({
      days: oct([
        dr('2026-10-07', { status: 'LOP', leaveCode: 'LOP', workedMin: 0 }),
        dr('2026-10-08', { status: 'H', leaveCode: 'CL' }),
        dr('2026-10-09', { status: 'H', leaveCode: 'LOP' }),
        dr('2026-10-10', { status: 'H', leaveCode: null }),
        dr('2026-10-12', { status: 'L', leaveCode: 'SL', workedMin: 0 }),
        dr('2026-10-13', { status: 'OPEN', open: true }),
        weekOff('2026-10-20', { status: 'OPEN', open: true }),
      ]),
    });
    expect(r.counts.lopDays).toBe(2.5);
    expect(r.counts.L).toBe(1.5);
    expect(formula(r, 'lop')).toBe('₹15,000 ÷ 31 days × 2.5 days');
  });

  it('sandwich on: week-offs between two unpaid days become LOP; off: they stay paid', () => {
    const days = oct([absent('2026-10-05'), absent('2026-10-07')]);
    const on = slip({ days, rules: rules({ sandwich: true }) });
    const off = slip({ days, rules: rules({ sandwich: false }) });
    expect(on.counts.lopDays).toBe(3);
    expect(off.counts.lopDays).toBe(2);
    expect(on.netPaise).toBeLessThan(off.netPaise);
  });

  describe('daily wage', () => {
    it.each([
      { name: 'paid holidays and week-offs', ho: true, wo: true, paid: 31 },
      { name: 'paid holidays only', ho: true, wo: false, paid: 27 },
      { name: 'neither', ho: false, wo: false, paid: 26 },
    ])('with $name', (c) => {
      const r = slip({
        person: meena(),
        days: oct([holiday('2026-10-02')]),
        rules: rules({ dailyPaidHolidays: c.ho, dailyPaidWeekOffs: c.wo }),
        holidays: [{ date: '2026-10-02', name: 'Fest', paid: true, workedComp: 'extra_pay' }],
      });
      expect(r.counts.paidDays).toBe(c.paid);
    });

    it('an unpaid holiday is not paid even when holidays are paid', () => {
      const r = slip({
        person: meena(),
        days: oct([holiday('2026-10-02')]),
        holidays: [{ date: '2026-10-02', name: 'Fest', paid: false, workedComp: 'extra_pay' }],
      });
      const paid = slip({ person: meena(), days: oct([holiday('2026-10-02')]) });
      expect(r.counts.paidDays).toBe(paid.counts.paidDays - 1);
    });
  });

  describe('off-day work', () => {
    const wo = oct([weekOff('2026-10-20', { workedMin: 510, offdayCredit: 1 })]);
    it('extra pay on a monthly week-off pays multiplier minus the paid day', () => {
      const r = slip({ days: wo, rules: rules({ weekOffWorked: 'extra_pay' }) });
      expect(amount(r, 'offday_extra')).toBe(48_387);
    });
    it('daily wage on an unpaid week-off pays the full multiplier', () => {
      const r = slip({
        person: meena(),
        days: wo,
        rules: rules({ weekOffWorked: 'extra_pay' }),
      });
      expect(formula(r, 'offday_extra')).toBe('₹550.00 × 2 × 1 day');
      expect(amount(r, 'offday_extra')).toBe(110_000);
    });
    it('daily wage on a paid week-off pays multiplier minus one', () => {
      const r = slip({
        person: meena(),
        days: wo,
        rules: rules({ weekOffWorked: 'extra_pay', dailyPaidWeekOffs: true }),
      });
      expect(amount(r, 'offday_extra')).toBe(55_000);
    });
    it.each([
      { comp: 'comp_off', extra: 0, earned: 1 },
      { comp: 'extra_pay', extra: 48_387, earned: 0 },
      { comp: 'both', extra: 48_387, earned: 1 },
    ] as const)('a worked holiday set to $comp', (c) => {
      const r = slip({
        days: oct([holiday('2026-10-02', { workedMin: 480, offdayCredit: 1 })]),
        holidays: [{ date: '2026-10-02', name: 'Fest', paid: true, workedComp: c.comp }],
      });
      expect(amount(r, 'offday_extra')).toBe(c.extra);
      expect(r.compOffEarned).toBe(c.earned);
    });
    it('a worked holiday without a holiday row defaults to extra pay', () => {
      const r = slip({ days: oct([holiday('2026-10-02', { workedMin: 480, offdayCredit: 1 })]) });
      expect(amount(r, 'offday_extra')).toBe(48_387);
    });
    it('two kinds of off-day credit join one line', () => {
      const r = slip({
        days: oct([
          weekOff('2026-10-20', { workedMin: 510, offdayCredit: 1 }),
          weekOff('2026-10-27', { workedMin: 240, offdayCredit: 0.5 }),
        ]),
        rules: rules({ weekOffWorked: 'extra_pay' }),
      });
      expect(r.lines.filter((l) => l.code === 'offday_extra')).toHaveLength(1);
      expect(amount(r, 'offday_extra')).toBe(72_581);
    });
  });

  describe('overtime modes', () => {
    const days = oct([dr('2026-10-14', { otCandidateMin: 120 })]);
    const approvals = [approve('2026-10-14', 120, 120)];
    it.each([{ m: 1 }, { m: 1.5 }, { m: 2 }] as const)('multiplier $m', ({ m }) => {
      const r = slip({
        days,
        approvals,
        person: person({ otRate: { mode: 'multiplier', multiplier: m } }),
      });
      // 120/540 of a day at r_day x m, rounded once
      expect(amount(r, 'overtime')).toBe(Math.round((48_387.0968 * m * 120) / 540));
      expect(r.otApprovedMin).toBe(120);
      expect(r.warnings.some((w) => w.code === 'ot_multiplier_low')).toBe(m < 2);
    });
    it('flat rate per hour', () => {
      const r = slip({
        days,
        approvals,
        person: person({ otRate: { mode: 'flat', paisePerHour: 15_000 } }),
      });
      expect(amount(r, 'overtime')).toBe(30_000);
      expect(formula(r, 'overtime')).toBe('₹150 an hour × 2 h');
    });
    it('comp-off mode turns 4 hours into half a day and pays nothing', () => {
      const four = oct([dr('2026-10-14', { otCandidateMin: 480 })]);
      const r = slip({
        days: four,
        approvals: [approve('2026-10-14', 480, 480)],
        person: person({ otRate: { mode: 'comp_off' } }),
      });
      expect(amount(r, 'overtime')).toBe(0);
      expect(r.compOffEarned).toBe(1);
    });
    it('unpaid mode pays nothing and earns nothing', () => {
      const r = slip({ days, approvals, person: person({ otRate: { mode: 'unpaid' } }) });
      expect(amount(r, 'overtime')).toBe(0);
      expect(r.compOffEarned).toBe(0);
      expect(r.otApprovedMin).toBe(120);
    });
    it('pre-approved minutes are paid without a decision; undecided candidates are pending', () => {
      const r = slip({
        days: oct([dr('2026-10-14', { otPreapprovedMin: 60, otCandidateMin: 30 })]),
        approvals: [
          { workDate: '2026-10-14', candidateMin: 30, approvedMin: 30, decision: 'auto' },
        ],
      });
      expect(r.otApprovedMin).toBe(60);
      expect(r.otPendingMin).toBe(30);
      expect(r.warnings.map((w) => w.code)).toContain('pending_overtime');
    });
    it('an approval cannot exceed the candidate minutes; a rejection pays nothing', () => {
      const d = oct([dr('2026-10-14', { otCandidateMin: 45 })]);
      expect(slip({ days: d, approvals: [approve('2026-10-14', 45, 90)] }).otApprovedMin).toBe(45);
      expect(slip({ days: d, approvals: [approve('2026-10-14', 45, 0)] }).otApprovedMin).toBe(0);
    });
    it('overtime on two salary parts gets one term per part', () => {
      const r = slip({
        person: person({
          salaryParts: [
            { from: '2026-10-01', to: '2026-10-15', type: 'monthly', amountPaise: 1_500_000 },
            { from: '2026-10-16', to: '2026-10-31', type: 'monthly', amountPaise: 1_800_000 },
          ],
        }),
        days: oct([
          dr('2026-10-14', { otCandidateMin: 60 }),
          dr('2026-10-21', { otCandidateMin: 60 }),
        ]),
        approvals: [approve('2026-10-14', 60, 60), approve('2026-10-21', 60, 60)],
      });
      expect(formula(r, 'overtime')).toContain(' + ');
    });
  });

  describe('warnings', () => {
    it.each([
      { basis: 'monthly', min: 1_600_000, warn: true },
      { basis: 'monthly', min: 1_500_000, warn: false },
      { basis: 'daily', min: 60_000, warn: true },
      { basis: 'daily', min: 50_000, warn: false },
    ] as const)('minimum wage $basis $min warns: $warn (monthly pay)', (c) => {
      const r = slip({ rules: rules({ minimumWagePaise: c.min, minimumWageBasis: c.basis }) });
      expect(r.warnings.some((w) => w.code === 'min_wage')).toBe(c.warn);
    });
    it('minimum wage on a daily-wage person compares 26 days', () => {
      const r = slip({
        person: meena(),
        rules: rules({ minimumWagePaise: 60_000, minimumWageBasis: 'daily' }),
      });
      expect(r.warnings.some((w) => w.code === 'min_wage')).toBe(true);
    });
    it('weekly hours over 48 warn, the quarter over 144 h warns', () => {
      const r = slip({
        days: oct([dr('2026-10-07', { workedMin: 900 })]),
        quarterOtMinBefore: 144 * 60,
        approvals: [],
        limits: { weeklyHours: 48, quarterlyOtHours: 144 },
      });
      expect(r.warnings.map((w) => w.code)).toContain('weekly_hours');
      const q = slip({
        days: oct([dr('2026-10-14', { otCandidateMin: 60 })]),
        approvals: [approve('2026-10-14', 60, 60)],
        quarterOtMinBefore: 144 * 60,
      });
      expect(q.warnings.map((w) => w.code)).toContain('quarterly_ot');
    });
  });
});

describe('PRD 14.2 cap and advances', () => {
  const adv = (due: number, override: number | null = null) => [advance(1, due, override)];

  it('an advance that fits is recovered in full', () => {
    const r = slip({ advances: adv(300_000) });
    expect(amount(r, 'advance_recovery')).toBe(-300_000);
    expect(r.advanceRecoveries[0]).toMatchObject({ recoveredPaise: 300_000, carriedPaise: 0 });
    expect(r.carryOut.advances).toEqual([]);
  });

  it('a partial fit carries the rest forward with a warning', () => {
    const r = slip({ advances: adv(1_000_000) });
    expect(amount(r, 'advance_recovery')).toBe(-750_000);
    expect(r.carryOut.advances).toEqual([{ advanceId: advance(1, 0).advanceId, paise: 250_000 }]);
    expect(r.warnings.map((w) => w.code)).toContain('cap_carry');
    expect(formula(r, 'advance_recovery')).toContain('fits under the 50% limit');
  });

  it('the owner can lower this month recovery; the lowered part carries', () => {
    const r = slip({ advances: adv(300_000, 100_000) });
    expect(amount(r, 'advance_recovery')).toBe(-100_000);
    expect(r.carryOut.advances[0]?.paise).toBe(200_000);
    expect(formula(r, 'advance_recovery')).toContain('lowered for this month');
    // an override above what is due is ignored
    expect(amount(slip({ advances: adv(300_000, 900_000) }), 'advance_recovery')).toBe(-300_000);
  });

  it('absence alone at or above 50% leaves nothing else deducted and warns', () => {
    const days = oct(
      Array.from({ length: 16 }, (_, i) => absent(`2026-10-${String(i + 1).padStart(2, '0')}`)),
    );
    const r = slip({
      days,
      advances: adv(100_000),
      adjustments: [adj(1, 'damage', 50_000)],
    });
    expect(amount(r, 'advance_recovery')).toBe(0);
    expect(amount(r, 'damage')).toBe(0);
    expect(r.warnings.map((w) => w.code)).toContain('absence_over_cap');
    expect(r.carryOut.advances[0]?.paise).toBe(100_000);
    expect(r.carryOut.damagePaise).toBe(50_000);
  });

  it('ordering: fines, damage, other deductions, then advances, each carrying what does not fit', () => {
    const r = slip({
      adjustments: [adj(1, 'damage', 500_000), adj(2, 'other_deduction', 400_000)],
      fines: [{ id: '01J0000000000000000000F001', amountPaise: 40_000, fineDate: '2026-10-05' }],
      advances: adv(300_000),
    });
    expect(amount(r, 'fine')).toBe(-40_000);
    expect(amount(r, 'damage')).toBe(-500_000);
    expect(amount(r, 'other_deduction')).toBe(-210_000);
    expect(amount(r, 'advance_recovery')).toBe(0);
    expect(r.carryOut).toMatchObject({ damagePaise: 0, otherPaise: 190_000 });
    expect(r.carryOut.advances[0]?.paise).toBe(300_000);
    expect(r.deductionsPaise).toBe(750_000);
  });

  it('carried-in damage and other amounts are taken before new ones', () => {
    const r = slip({
      carryIn: { ...NO_CARRY, damagePaise: 100_000, otherPaise: 50_000 },
      adjustments: [adj(1, 'recovery', 20_000)],
    });
    expect(amount(r, 'damage')).toBe(-100_000);
    expect(amount(r, 'other_deduction')).toBe(-50_000);
    expect(amount(r, 'recovery')).toBe(-20_000);
    expect(r.lines.find((l) => l.code === 'damage')?.formula).toBe('Carried from last month');
  });

  it('an earlier carry that still does not fit is reported with a warning', () => {
    const r = slip({
      carryIn: { ...NO_CARRY, damagePaise: 900_000 },
    });
    expect(amount(r, 'damage')).toBe(-750_000);
    expect(r.carryOut.damagePaise).toBe(150_000);
  });

  it('fines are capped at 3% of gross and lapse after 90 days', () => {
    const r = slip({
      fines: [
        { id: '01J0000000000000000000F001', amountPaise: 100_000, fineDate: '2026-10-05' },
        { id: '01J0000000000000000000F002', amountPaise: 10_000, fineDate: '2026-10-06' },
        { id: '01J0000000000000000000F003', amountPaise: 10_000, fineDate: '2026-07-01' },
      ],
    });
    expect(amount(r, 'fine')).toBe(-45_000);
    expect(r.lines.filter((l) => l.code === 'fine')).toHaveLength(1);
  });

  it('fines carried in that exceed the cap room carry on', () => {
    const r = slip({
      carryIn: {
        ...NO_CARRY,
        fines: [{ fineId: '01J0000000000000000000F009', paise: 20_000, fineDate: '2026-09-15' }],
      },
      adjustments: [adj(1, 'damage', 800_000)],
    });
    expect(amount(r, 'fine')).toBe(-20_000);
    expect(amount(r, 'damage')).toBe(-730_000);
    const tight = slip({
      carryIn: {
        ...NO_CARRY,
        fines: [{ fineId: '01J0000000000000000000F009', paise: 20_000, fineDate: '2026-09-15' }],
      },
      days: oct(
        Array.from({ length: 16 }, (_, i) => absent(`2026-10-${String(i + 1).padStart(2, '0')}`)),
      ),
    });
    expect(tight.carryOut.fines).toEqual([
      { fineId: '01J0000000000000000000F009', paise: 20_000, fineDate: '2026-09-15' },
    ]);
    expect(tight.warnings.some((w) => w.message.includes('fines'))).toBe(true);
  });

  describe('instalments with the paise remainder on the last', () => {
    it.each([
      { amount: 1_000_000, n: 3, plan: [333_333, 333_333, 333_334] },
      { amount: 100_000, n: 1, plan: [100_000] },
      { amount: 1_000_001, n: 4, plan: [250_000, 250_000, 250_000, 250_001] },
    ])('$amount over $n', ({ amount: a, n, plan }) => {
      expect(instalmentPlan(a, n)).toEqual(plan);
      expect(instalmentPlan(a, n).reduce((s, x) => s + x, 0)).toBe(a);
    });
    it('advanceInstalment follows the plan by month and is 0 outside it', () => {
      const a = {
        amountPaise: 1_000_000,
        plan: 'instalments',
        instalmentsN: 3,
        firstMonth: '2026-10',
      } as const;
      expect(advanceInstalment(a, '2026-10')).toBe(333_333);
      expect(advanceInstalment(a, '2026-12')).toBe(333_334);
      expect(advanceInstalment(a, '2027-01')).toBe(0);
      expect(advanceInstalment(a, '2026-09')).toBe(0);
      expect(advanceInstalment({ ...a, plan: 'full' }, '2026-10')).toBe(1_000_000);
      expect(advanceInstalment({ ...a, plan: 'instalments', instalmentsN: null }, '2026-10')).toBe(
        1_000_000,
      );
    });
  });

  it('salaryParts splits history at each effective date', () => {
    const parts = salaryParts(
      [
        { effectiveFrom: '2026-10-16', type: 'monthly', amountPaise: 1_800_000 },
        { effectiveFrom: '2025-04-01', type: 'monthly', amountPaise: 1_500_000 },
        { effectiveFrom: '2026-12-01', type: 'monthly', amountPaise: 2_000_000 },
      ],
      '2026-10',
    );
    expect(parts).toEqual([
      { from: '2026-10-01', to: '2026-10-15', type: 'monthly', amountPaise: 1_500_000 },
      { from: '2026-10-16', to: '2026-10-31', type: 'monthly', amountPaise: 1_800_000 },
    ]);
    expect(
      salaryParts([{ effectiveFrom: '2026-10-01', type: 'daily', amountPaise: 1 }], NOV),
    ).toHaveLength(1);
  });
});

describe('pay property tests (PRD 14.2)', () => {
  const dates = Array.from({ length: 31 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);
  const status = fc.constantFrom<'P' | 'H' | 'A' | 'LOP' | 'L'>(
    'P',
    'P',
    'P',
    'H',
    'A',
    'LOP',
    'L',
  );
  const day = (date: string, s: 'P' | 'H' | 'A' | 'LOP' | 'L', ut: number, ot: number): DayResult =>
    dr(date, {
      status: s,
      workedMin: s === 'A' || s === 'LOP' || s === 'L' ? 0 : 540,
      undertimeMin: s === 'P' ? ut : 0,
      otCandidateMin: s === 'P' ? ot : 0,
    });
  const otRate = fc.constantFrom<OtRate>(
    { mode: 'multiplier', multiplier: 1 },
    { mode: 'multiplier', multiplier: 1.5 },
    { mode: 'multiplier', multiplier: 2 },
    { mode: 'flat', paisePerHour: 12_345 },
    { mode: 'comp_off' },
    { mode: 'unpaid' },
  );
  const kind = fc.constantFrom<Adjustment['kind']>(
    'incentive',
    'bonus',
    'other_earning',
    'arrears',
    'damage',
    'other_deduction',
    'recovery',
  );
  const scenario = fc.record({
    salary: fc.integer({ min: 300_000, max: 9_000_000 }),
    divisor: fc.constantFrom('calendar', 'fixed30', 'fixed26', 'working'),
    ot: otRate,
    days: fc.array(
      fc.tuple(status, fc.integer({ min: 0, max: 120 }), fc.integer({ min: 0, max: 240 })),
      { minLength: 31, maxLength: 31 },
    ),
    adjustments: fc.array(fc.tuple(kind, fc.integer({ min: 1, max: 2_000_000 })), { maxLength: 5 }),
    advances: fc.array(
      fc.tuple(
        fc.integer({ min: 1, max: 3_000_000 }),
        fc.option(fc.integer({ min: 0, max: 3_000_000 }), { nil: null }),
      ),
      { maxLength: 3 },
    ),
    fines: fc.array(fc.integer({ min: 1, max: 500_000 }), { maxLength: 3 }),
    carryDamage: fc.integer({ min: 0, max: 500_000 }),
  });

  it('net = gross - deductions (within rounding) and deductions stay under 50% unless absence alone exceeds it', () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const r = slip({
          person: person({
            divisor: s.divisor,
            otRate: s.ot,
            salaryParts: [
              { from: '2026-10-01', to: '2026-10-31', type: 'monthly', amountPaise: s.salary },
            ],
          }),
          days: s.days.map(([st, ut, ot], i) => day(dates[i] as string, st, ut, ot)),
          approvals: s.days.map(([, , ot], i) => approve(dates[i] as string, ot, ot)),
          adjustments: s.adjustments.map(([k, p], i) => adj(i + 1, k, p)),
          advances: s.advances.map(([due, over], i) => advance(i + 1, due, over)),
          fines: s.fines.map((p, i) => ({
            id: `01J0000000000000000000F${String(i).padStart(3, '0')}`,
            amountPaise: p,
            fineDate: '2026-10-10',
          })),
          carryIn: { ...NO_CARRY, damagePaise: s.carryDamage },
        });
        expect(() => PayslipSchema.parse(r)).not.toThrow();
        expect(r.netBeforeRoundingPaise).toBe(r.grossPaise - r.deductionsPaise);
        expect(Math.abs(r.netPaise - r.netBeforeRoundingPaise)).toBeLessThanOrEqual(50);
        expect(r.netPaise % 100).toBe(0);
        const time = -(amount(r, 'lop') + amount(r, 'undertime'));
        const cap = Math.floor(r.grossPaise / 2);
        if (time <= cap) expect(r.deductionsPaise).toBeLessThanOrEqual(cap);
        else expect(r.deductionsPaise).toBe(time);
        for (const l of r.lines) {
          expect(l.kind === 'deduction' ? l.amountPaise <= 0 : true).toBe(true);
        }
      }),
      { numRuns: 300, seed: 20261019 },
    );
  });

  it('computePayslip is deterministic', () => {
    const i = { days: oct([absent('2026-10-07')]), advances: [advance(1, 123_457)] };
    expect(slip(i)).toEqual(slip(i));
  });
});
