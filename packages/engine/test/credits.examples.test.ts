import type {
  ConfirmedAway,
  CreditRules,
  DayResult,
  PersonPolicy,
  PunchForCalc,
  TemplateRule,
  TimeRules,
} from '@fs/contracts';
import { monthDates, PayslipResult as PayslipSchema, weekday } from '@fs/contracts';
import { describe, expect, it } from 'vitest';
import { creditBalance, creditEntriesForDay, creditRate, creditValue } from '../src/credits';
import { computeDay } from '../src/day';
import { frac, toPaise } from '../src/money';
import { computePayslip, timeLines } from '../src/pay';
import { resolveSchedule } from '../src/schedule';
import { at, nextId, OWNER, person as policy, punch, RULES as TIME_RULES, TPL } from './fixtures';
import { amount, approve, formula, input, NOV, OCT, person } from './pay-fixtures';

const ON: TimeRules = { ...TIME_RULES, credits: true };
const DEC = '2026-12';
const EVENING: TemplateRule = {
  id: '01J0000000000000000000T007',
  name: 'Evening',
  segments: [{ start: '15:00', end: '20:00' }],
  breakMin: 0,
};

const pc = (kind: PunchForCalc['kind'], effectiveTs: number): PunchForCalc => ({
  id: nextId(),
  kind,
  effectiveTs,
  status: 'accepted',
  source: 'online',
  offsiteDutyId: null,
});

/**
 * A month of day results from scripted punches (IST wall clock). Sundays use the Sunday template so
 * a plain week is 48 hours; `roster` sets other templates; unscripted working days are a full shift.
 */
function month(
  ym: string,
  script: Record<string, string[]>,
  rules: TimeRules,
  o: { policy?: PersonPolicy; roster?: Record<string, TemplateRule> } = {},
): DayResult[] {
  const p = o.policy ?? policy();
  const calendar = {
    holidays: [],
    rosterOverrides: monthDates(ym).flatMap((date) => {
      const template = o.roster?.[date] ?? (weekday(date) === 0 ? TPL.sunday : undefined);
      return template === undefined ? [] : [{ date, kind: 'template' as const, template }];
    }),
  };
  return monthDates(ym).map((date) => {
    const schedule = resolveSchedule(p, date, calendar);
    const first = schedule.segments[0];
    const last = schedule.segments[schedule.segments.length - 1];
    const times = script[date];
    const punches =
      times !== undefined
        ? times.map((t, i) => punch(date, i % 2 === 0 ? 'in' : 'out', t))
        : first !== undefined && last !== undefined
          ? [pc('in', first.startTs), pc('out', last.endTs)]
          : [];
    return computeDay({ schedule, punches, preapprovals: [], leave: null, rules, override: null });
  });
}

const rules = (otApprovedMin = 0): CreditRules => ({
  enabled: true,
  otApprovedMin,
  lateSourceId: '01J0000000000000000000P001',
  earlySourceId: '01J0000000000000000000P002',
  otSourceId: '01J0000000000000000000D001',
});

/** Active ledger rows for a list of days, with the approved overtime per date. */
const ledger = (days: DayResult[], ot: Record<string, number> = {}, aways: ConfirmedAway[] = []) =>
  days
    .flatMap((d) => creditEntriesForDay(d, aways, rules(ot[d.workDate] ?? 0)))
    .map((e) => ({ ...e, status: 'active' as const }));

const kinds = (entries: { kind: string; minutes: number }[]) =>
  entries.map((e) => `${e.kind} ${e.minutes}`);

const confirmedAway = (n: number, date: string, from: string, minutes: number): ConfirmedAway => ({
  id: `01J0000000000000000000Y${String(n).padStart(3, '0')}`,
  workDate: date,
  startTs: at(date, from),
  endTs: at(date, from) + minutes * 60_000,
  minutes,
  confirmedBy: OWNER,
});

describe('PRD 7.15 example 13: late every day, plus overtime (Time credits on)', () => {
  const lates = ['01', '02', '03', '05', '07', '08', '17'].map((d) => `2026-10-${d}`);
  const script = Object.fromEntries(
    lates.map((d) => [d, ['10:10', d === '2026-10-17' ? '22:10' : '20:00']]),
  );
  const approvals = [approve('2026-10-17', 120, 120)];
  const off = month(OCT, script, TIME_RULES);
  const on = month(OCT, script, ON);
  const rate = creditRate(person(), OCT);
  const entries = ledger(on, { '2026-10-17': 120 });
  const settle = (settleMin: number) =>
    computePayslip(
      input({
        days: on,
        approvals,
        creditDays: monthDates(OCT),
        settlement: { balanceMin: 50, settleMin, rate },
      }),
    );

  it("today's rules: 7 x 10 min inside the grace cost ₹0.00; 120 min at 2x pay ₹215.05", () => {
    expect(off.find((d) => d.workDate === '2026-10-17')?.otCandidateMin).toBe(120);
    const r = computePayslip(input({ days: off, approvals }));
    expect(r.lateBillableMin).toBe(0);
    expect(amount(r, 'undertime')).toBe(0);
    expect(amount(r, 'overtime')).toBe(21_505);
  });

  it('ledger: 7 x (-10) and +120 make +50, worth about ₹44.80 (one rounding of the net minutes)', () => {
    expect(kinds(entries)).toEqual([...Array(7).fill('late -10'), 'ot 120']);
    expect(creditBalance(entries, [], [], '2026-10-31')).toBe(50);
    expect(rate).toEqual({ rDay: { num: 1_500_000, den: 31 }, sStd: 540 });
    expect(creditValue(50, rate)).toBe(4_480);
    expect(creditValue(120, rate) + creditValue(-70, rate)).toBe(4_481);
  });

  it('settle 0: nothing on the payslip and +50 carries over', () => {
    const r = settle(0);
    expect(r.lines.map((l) => l.code)).toEqual(['salary']);
    expect(r).toMatchObject({
      grossPaise: 1_500_000,
      netPaise: 1_500_000,
      credits: { appliedMin: 0, amountPaise: 0, stayMin: 50 },
    });
  });

  it('settle +50: a payslip earning "Time credits: +50 min, +₹44.80" and a balance of 0', () => {
    const r = settle(50);
    expect(() => PayslipSchema.parse(r)).not.toThrow();
    expect(r.lines.map((l) => l.code)).toEqual(['salary', 'time_credits', 'rounding']);
    expect(amount(r, 'time_credits')).toBe(4_480);
    expect(formula(r, 'time_credits')).toBe('₹483.87 × 50 min ÷ 540');
    expect(r).toMatchObject({
      grossPaise: 1_504_480,
      netBeforeRoundingPaise: 1_504_480,
      netPaise: 1_504_500,
      roundingPaise: 20,
      credits: { appliedMin: 50, amountPaise: 4_480, stayMin: 0 },
    });
    const applied = { month: OCT, appliedMin: 50, status: 'applied' as const };
    expect(creditBalance(entries, [], [applied], '2026-10-31')).toBe(0);
  });

  it('adjust: +10 for an excused late makes the balance +60', () => {
    const excused = { workDate: '2026-10-01', deltaMin: 10, status: 'active' as const };
    expect(creditBalance(entries, [excused], [], '2026-10-31')).toBe(60);
  });
});

describe('PRD 7.15 example 14: a minus month, carried over, then partly settled (Time credits on)', () => {
  const kajal = policy({ weekOffDow: 1 });
  const pay = person({}, NOV, 1_200_000);
  const others = ['04', '06', '07', '11', '12', '13', '14', '18'];
  const script: Record<string, string[]> = {
    '2026-11-03': ['10:25', '20:00'],
    '2026-11-05': ['10:10', '19:40'],
    '2026-11-20': ['10:00', '20:45'],
    ...Object.fromEntries(others.map((d) => [`2026-11-${d}`, ['10:10', '20:00']])),
  };
  const approvals = [approve('2026-11-20', 45, 45)];
  const away = [confirmedAway(1, '2026-11-17', '18:00', 40)];
  const offNov = month(NOV, script, TIME_RULES, { policy: kajal });
  const onNov = month(NOV, script, ON, { policy: kajal });
  const nov = ledger(onNov, { '2026-11-20': 45 }, away);
  const rate = creditRate(pay, NOV);
  const dec = ledger(
    month(DEC, { '2026-12-02': ['10:10', '20:00'], '2026-12-03': ['10:10', '20:00'] }, ON, {
      policy: kajal,
    }),
  );
  const novSettled = { month: NOV, appliedMin: 0, status: 'applied' as const };
  const decSettled = { month: DEC, appliedMin: -100, status: 'applied' as const };

  it("today's rules would cut 35 min (₹25.93) and pay ₹66.67 overtime", () => {
    const r = computePayslip(input({ person: pay, month: NOV, days: offNov, approvals }));
    expect(amount(r, 'undertime')).toBe(-2_593);
    expect(amount(r, 'overtime')).toBe(6_667);
  });

  it('November ledger: -25 -10 -20 -40 -80 +45 = -130, "might cut around ₹96.30"', () => {
    expect(kinds(nov)).toEqual([
      'late -25',
      'late -10',
      'late -10',
      'early -20',
      ...Array(6).fill('late -10'),
      'away -40',
      'late -10',
      'ot 45',
    ]);
    expect(creditBalance(nov, [], [], '2026-11-30')).toBe(-130);
    expect(rate).toEqual({ rDay: { num: 40_000, den: 1 }, sStd: 540 });
    expect(creditValue(-130, rate)).toBe(-9_630);
  });

  it('November: settle 0, salary ₹12,000.00, no time-credits line; -130 carries over', () => {
    const r = computePayslip(
      input({
        person: pay,
        month: NOV,
        days: onNov,
        approvals,
        creditDays: monthDates(NOV),
        settlement: { balanceMin: -130, settleMin: 0, rate },
      }),
    );
    expect(r.lines.map((l) => l.code)).toEqual(['salary']);
    expect(r).toMatchObject({ netPaise: 1_200_000, credits: { stayMin: -130 } });
  });

  it('December: -20 more makes -150; settle -100 cuts ₹74.07, net ₹11,926 (+₹0.07), -50 stays', () => {
    expect(kinds(dec)).toEqual(['late -10', 'late -10']);
    const entries = [...nov, ...dec];
    expect(creditBalance(entries, [], [novSettled], '2026-12-31')).toBe(-150);
    // The example values December at ₹400 a day, as stated; the engine settles at the rate it is given.
    const r = computePayslip(
      input({
        person: person({}, DEC, 1_200_000),
        month: DEC,
        days: month(DEC, {}, ON, { policy: kajal }),
        creditDays: monthDates(DEC),
        settlement: { balanceMin: -150, settleMin: -100, rate },
      }),
    );
    expect(() => PayslipSchema.parse(r)).not.toThrow();
    expect(amount(r, 'time_credits')).toBe(-7_407);
    expect(formula(r, 'time_credits')).toBe('₹400.00 × 100 min ÷ 540');
    expect(r).toMatchObject({
      grossPaise: 1_200_000,
      netBeforeRoundingPaise: 1_192_593,
      netPaise: 1_192_600,
      roundingPaise: 7,
      credits: { appliedMin: -100, amountPaise: -7_407, stayMin: -50 },
    });
    expect(creditBalance(entries, [], [novSettled, decSettled], '2026-12-31')).toBe(-50);
    expect(creditValue(-50, rate)).toBe(-3_704);
  });

  it('January: the 5 Nov early entry adjusted -20 -> 0 (+20) makes -30, "might cut around ₹22.22"; void restores -50', () => {
    const entries = [...nov, ...dec];
    const adj = { workDate: '2026-11-05', deltaMin: 20, status: 'active' as const };
    const settled = [novSettled, decSettled];
    expect(nov.find((e) => e.workDate === '2026-11-05' && e.kind === 'early')?.minutes).toBe(-20);
    expect(creditBalance(entries, [adj], settled, '2027-01-31')).toBe(-30);
    expect(creditValue(-30, rate)).toBe(-2_222);
    expect(creditBalance(entries, [{ ...adj, status: 'void' }], settled, '2027-01-31')).toBe(-50);
  });
});

describe('PRD 7.15 example 15: away time, step-outs and early leave (Time credits on)', () => {
  const roster = { '2026-11-12': EVENING, '2026-11-13': EVENING, '2026-11-14': EVENING };
  const script = {
    '2026-11-12': ['15:00', '20:00'],
    '2026-11-13': ['15:00', '19:30'],
    '2026-11-14': ['15:00', '20:00'],
  };
  const pick = (days: DayResult[], date: string) => days.filter((d) => d.workDate === date);
  const on = month(NOV, script, ON, { roster });
  const off = month(NOV, script, TIME_RULES, { roster });
  // The example values Priya's minutes at ₹483.87 a day (r_day of October), as stated.
  const rate = creditRate(person(), OCT);
  const rollCall = confirmedAway(1, '2026-11-12', '18:00', 40);
  const stepOut = confirmedAway(2, '2026-11-14', '16:05', 25);

  it('12 Nov: Not here at the 18:00 roll-call, back at 18:40: away -40 at once, ₹35.84', () => {
    const e = ledger(pick(on, '2026-11-12'), {}, [rollCall]);
    expect(e).toMatchObject([
      { kind: 'away', minutes: -40, sourceId: rollCall.id, confirmed: true },
    ]);
    expect(creditValue(-40, rate)).toBe(-3_584);
  });

  it('14 Nov: a work errand marked as work gives no entry; confirmed it would be -25', () => {
    expect(ledger(pick(on, '2026-11-14'))).toEqual([]);
    expect(kinds(ledger(pick(on, '2026-11-14'), {}, [stepOut]))).toEqual(['away -25']);
  });

  it("13 Nov: out 19:30 is early -30 from the first minute, ₹26.88 on S_std (today's rule ₹48.39 on S_day)", () => {
    const [day] = pick(on, '2026-11-13');
    expect(day).toMatchObject({ scheduledMin: 300, earlyMin: 30, undertimeMin: 0, status: 'P' });
    expect(kinds(ledger(pick(on, '2026-11-13')))).toEqual(['early -30']);
    expect(creditValue(-30, rate)).toBe(-2_688);
    const today = pick(off, '2026-11-13')[0] as DayResult;
    expect(today).toMatchObject({ earlyBillableMin: 30, undertimeMin: 30 });
    const t = timeLines({
      days: [
        {
          day: today,
          status: 'P',
          part: { index: 0, monthly: true, rate: frac(1_500_000, 31) },
          offPaid: true,
          offMode: 'extra_pay',
          credits: false,
        },
      ],
      approvals: [],
      otRate: { mode: 'multiplier', multiplier: 2 },
      stdMin: 540,
      offdayMultiplier: 2,
    });
    expect(toPaise(t.undertime.amount)).toBe(4_839);
  });

  it('balance from the 12 Nov away and the 13 Nov early leave: -70', () => {
    const entries = ledger(on, {}, [rollCall]);
    expect(creditBalance(entries, [], [], '2026-11-30')).toBe(-70);
  });
});
