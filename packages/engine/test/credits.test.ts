import type { ConfirmedAway, CreditRules, MinuteRate, TimeRules } from '@fs/contracts';
import {
  CreditEntryDraft as DraftSchema,
  isoWeekOf,
  minToHhmm,
  PayslipResult as PayslipSchema,
} from '@fs/contracts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  creditBalance,
  creditEntriesForDay,
  creditRate,
  creditsOn,
  creditValue,
  legalOvertime,
  settleCredits,
} from '../src/credits';
import { computeDay } from '../src/day';
import { frac, mul, toPaise } from '../src/money';
import { computePayslip } from '../src/pay';
import {
  at,
  input as dayInput,
  OWNER,
  override,
  punch,
  RULES as TIME_RULES,
  WED,
} from './fixtures';
import {
  absent,
  advance,
  amount,
  approve,
  dr,
  formula,
  input,
  meena,
  monthOf,
  NOV,
  OCT,
  oct,
  person,
  RULES,
  weekOff,
} from './pay-fixtures';

const ON: TimeRules = { ...TIME_RULES, credits: true };
/** Priya, October 2026: r_day = 15,000 / 31. */
const PRIYA: MinuteRate = { rDay: { num: 1_500_000, den: 31 }, sStd: 540 };
/** Kajal, November 2026: r_day = 12,000 / 30 = ₹400. */
const KAJAL: MinuteRate = { rDay: { num: 40_000, den: 1 }, sStd: 540 };

const rules = (over: Partial<CreditRules> = {}): CreditRules => ({
  enabled: true,
  otApprovedMin: 0,
  lateSourceId: '01J0000000000000000000P001',
  earlySourceId: '01J0000000000000000000P002',
  otSourceId: '01J0000000000000000000D001',
  ...over,
});

const away = (n: number, workDate: string, minutes: number, start = '18:00'): ConfirmedAway => ({
  id: `01J0000000000000000000Y${String(n).padStart(3, '0')}`,
  workDate,
  startTs: at(workDate, start),
  endTs: at(workDate, start) + minutes * 60_000,
  minutes,
  confirmedBy: OWNER,
});

const sumMin = (entries: { minutes: number }[]) => entries.reduce((s, e) => s + e.minutes, 0);
const active = (entries: { workDate: string; minutes: number }[]) =>
  entries.map((e) => ({ ...e, status: 'active' as const }));

describe('PRD 14.2 time credits: computeDay with rules.credits', () => {
  const both = (times: string[], over: Parameters<typeof dayInput>[0] = {}) => {
    const punches = times.map((t, i) => punch(WED, i % 2 === 0 ? 'in' : 'out', t));
    return {
      off: computeDay(dayInput({ punches, ...over })),
      on: computeDay(dayInput({ punches, rules: ON, ...over })),
    };
  };

  it.each([
    {
      name: 'late 10 min, all inside the grace: 0 billable off, 10 from the first minute on',
      times: ['10:10', '20:00'],
      off: { lateMin: 10, lateBillableMin: 0, undertimeMin: 0 },
      on: { lateMin: 10, lateBillableMin: 10, undertimeMin: 0 },
    },
    {
      name: 'late 25 min: 15 billable and undertime off; 25 and no undertime on',
      times: ['10:25', '20:00'],
      off: { lateBillableMin: 15, undertimeMin: 15 },
      on: { lateBillableMin: 25, undertimeMin: 0, makeupMin: 0 },
    },
    {
      name: 'early 10 min, inside the tolerance: 0 off, 10 from the first minute on',
      times: ['10:00', '19:50'],
      off: { earlyMin: 10, earlyBillableMin: 0 },
      on: { earlyMin: 10, earlyBillableMin: 10, undertimeMin: 0 },
    },
    {
      name: 'make-up does not apply: late 20 and out 20:45 keeps the late and all 45 after minutes',
      times: ['10:20', '20:45'],
      off: { makeupMin: 10, undertimeMin: 0, otCandidateMin: 30 },
      on: { lateMin: 20, makeupMin: 0, undertimeMin: 0, otCandidateMin: 45 },
    },
    {
      name: 'example 5 row 3: in 10:40, out 20:10 is 20 min undertime off and none on',
      times: ['10:40', '20:10'],
      off: { makeupMin: 10, undertimeMin: 20 },
      on: { lateMin: 40, makeupMin: 0, undertimeMin: 0, otCandidateMin: 0 },
    },
  ])('$name', ({ times, off, on }) => {
    const r = both(times);
    expect(r.off).toMatchObject(off);
    expect(r.on).toMatchObject(on);
    expect(r.on).toMatchObject({ status: r.off.status, workedMin: r.off.workedMin });
  });

  it('over-break is shown with a tag but gives no undertime with credits on', () => {
    const brk = { ...TIME_RULES, breakPunches: true };
    const punches = [
      punch(WED, 'in', '10:00'),
      punch(WED, 'break_start', '14:00'),
      punch(WED, 'break_end', '15:30'),
      punch(WED, 'out', '20:00'),
    ];
    const off = computeDay(dayInput({ punches, rules: brk }));
    const on = computeDay(dayInput({ punches, rules: { ...brk, credits: true } }));
    expect(off).toMatchObject({ overbreakMin: 30, undertimeMin: 30 });
    expect(off.tags).not.toContain('overbreak');
    expect(on).toMatchObject({ overbreakMin: 30, undertimeMin: 0, makeupMin: 0 });
    expect(on.tags).toContain('overbreak');
    expect(creditEntriesForDay(on, [], rules())).toEqual([]);
  });

  it('credits: false is the same as no credits field', () => {
    const punches = [punch(WED, 'in', '10:25'), punch(WED, 'out', '20:40')];
    expect(computeDay(dayInput({ punches, rules: { ...TIME_RULES, credits: false } }))).toEqual(
      computeDay(dayInput({ punches })),
    );
  });

  it('property: credits on keeps every measured minute and status, owes nothing, never fewer overtime candidates', () => {
    const minute = fc.integer({ min: 8 * 60, max: 23 * 60 });
    fc.assert(
      fc.property(fc.array(minute, { minLength: 0, maxLength: 4 }), (raw) => {
        const times = [...raw].sort((a, b) => a - b).map(minToHhmm);
        const { off, on } = both(times);
        for (const k of [
          'status',
          'workedMin',
          'breakMin',
          'lateMin',
          'earlyMin',
          'overbreakMin',
        ] as const) {
          expect(on[k]).toEqual(off[k]);
        }
        expect(on).toMatchObject({
          undertimeMin: 0,
          makeupMin: 0,
          lateBillableMin: on.lateMin,
          earlyBillableMin: on.earlyMin,
        });
        expect(on.otCandidateMin).toBeGreaterThanOrEqual(off.otCandidateMin);
        expect(on.otPreapprovedMin).toBeGreaterThanOrEqual(off.otPreapprovedMin);
      }),
    );
  });
});

describe('PRD 14.2 time credits: entries for a day', () => {
  it('late and early from the first minute, each counted away interval, approved overtime', () => {
    const day = dr(WED, { lateMin: 25, earlyMin: 20, lateBillableMin: 15, earlyBillableMin: 20 });
    const entries = creditEntriesForDay(
      day,
      [
        away(1, WED, 40, '18:00'),
        away(2, WED, 15, '12:00'),
        away(3, '2026-10-08', 30),
        away(4, WED, 0),
      ],
      rules({ otApprovedMin: 45 }),
    );
    expect(entries).toEqual([
      {
        workDate: WED,
        kind: 'late',
        minutes: -25,
        sourceKind: 'punch',
        sourceId: '01J0000000000000000000P001',
        confirmed: false,
      },
      {
        workDate: WED,
        kind: 'early',
        minutes: -20,
        sourceKind: 'punch',
        sourceId: '01J0000000000000000000P002',
        confirmed: false,
      },
      {
        workDate: WED,
        kind: 'away',
        minutes: -15,
        sourceKind: 'presence',
        sourceId: away(2, WED, 15).id,
        confirmed: true,
      },
      {
        workDate: WED,
        kind: 'away',
        minutes: -40,
        sourceKind: 'presence',
        sourceId: away(1, WED, 40).id,
        confirmed: true,
      },
      {
        workDate: WED,
        kind: 'ot',
        minutes: 45,
        sourceKind: 'ot_decision',
        sourceId: '01J0000000000000000000D001',
        confirmed: true,
      },
    ]);
    for (const e of entries) expect(() => DraftSchema.parse(e)).not.toThrow();
  });

  it.each([
    { status: 'H' as const },
    { status: 'A' as const },
    { status: 'L' as const },
    { status: 'LOP' as const },
    { status: 'OPEN' as const },
  ])('minus only on P days: a $status day keeps only its approved overtime', ({ status }) => {
    const day = dr(WED, { status, lateMin: 30, earlyMin: 60 });
    expect(creditEntriesForDay(day, [away(1, WED, 40)], rules())).toEqual([]);
    expect(
      creditEntriesForDay(day, [away(1, WED, 40)], rules({ otApprovedMin: 30 })).map((e) => [
        e.kind,
        e.minutes,
      ]),
    ).toEqual([['ot', 30]]);
  });

  it('a worked off day gives a plus entry for approved overtime; pending or rejected (0 approved) gives nothing', () => {
    const off = weekOff('2026-10-20', { workedMin: 120, otCandidateMin: 120 });
    expect(sumMin(creditEntriesForDay(off, [], rules({ otApprovedMin: 120 })))).toBe(120);
    expect(creditEntriesForDay(off, [], rules({ otApprovedMin: 0 }))).toEqual([]);
  });

  it('the owner overriding a day to a non-P status removes its minus entries', () => {
    const punches = [punch(WED, 'in', '10:25'), punch(WED, 'out', '19:30')];
    const p = computeDay(dayInput({ punches, rules: ON }));
    const h = computeDay(dayInput({ punches, rules: ON, override: override({ status: 'H' }) }));
    expect(sumMin(creditEntriesForDay(p, [], rules()))).toBe(-55);
    expect(creditEntriesForDay(h, [], rules())).toEqual([]);
  });

  it('nothing when credits are off for the day or the person was not employed', () => {
    const day = dr(WED, { lateMin: 25 });
    expect(creditEntriesForDay(day, [], rules({ enabled: false, otApprovedMin: 30 }))).toEqual([]);
    const ne = dr(WED, { dayType: 'NE', status: 'NE' });
    expect(creditEntriesForDay(ne, [], rules({ otApprovedMin: 30 }))).toEqual([]);
  });

  it('missing source ids are left empty for the caller', () => {
    const day = dr(WED, { lateMin: 5, earlyMin: 5 });
    const none = rules({
      otApprovedMin: 15,
      lateSourceId: null,
      earlySourceId: null,
      otSourceId: null,
    });
    expect(creditEntriesForDay(day, [], none).map((e) => e.sourceId)).toEqual(['', '', '']);
  });

  it.each([
    { setting: { enabled: true, startDate: null }, person: null, date: '2026-10-01', on: true },
    {
      setting: { enabled: true, startDate: '2026-10-15' },
      person: null,
      date: '2026-10-14',
      on: false,
    },
    {
      setting: { enabled: true, startDate: '2026-10-15' },
      person: true,
      date: '2026-10-15',
      on: true,
    },
    { setting: { enabled: true, startDate: null }, person: false, date: '2026-10-15', on: false },
    { setting: { enabled: false, startDate: null }, person: true, date: '2026-10-15', on: false },
  ])('credits_on: $setting, person $person, $date -> $on', ({ setting, person: p, date, on }) => {
    expect(creditsOn(setting, p, date)).toBe(on);
  });
});

describe('PRD 14.2 time credits: balance', () => {
  const entries = active([
    { workDate: '2026-10-01', minutes: -70 },
    { workDate: '2026-10-17', minutes: 120 },
    { workDate: '2026-11-03', minutes: -25 },
  ]);

  it('carries across months and across a sign change, with no monthly reset', () => {
    expect(creditBalance(entries, [], [], '2026-10-16')).toBe(-70);
    expect(creditBalance(entries, [], [], '2026-10-31')).toBe(50);
    expect(creditBalance(entries, [], [], '2026-11-30')).toBe(25);
  });

  it('superseded entries do not count; adjustments survive a recompute; a void adjustment restores', () => {
    const recomputed = [
      { workDate: '2026-10-01', minutes: -10, status: 'superseded' as const },
      ...entries,
    ];
    const adj = { workDate: '2026-10-01', deltaMin: 10, status: 'active' as const };
    expect(creditBalance(recomputed, [adj], [], '2026-10-31')).toBe(60);
    expect(creditBalance(recomputed, [{ ...adj, status: 'void' }], [], '2026-10-31')).toBe(50);
    expect(creditBalance(recomputed, [{ ...adj, workDate: '2026-11-01' }], [], '2026-10-31')).toBe(
      50,
    );
  });

  it('only applied settlements whose month has ended reduce it; reopen (void) restores', () => {
    const s = { month: OCT, appliedMin: 50, status: 'applied' as const };
    expect(creditBalance(entries, [], [s], '2026-10-31')).toBe(0);
    expect(creditBalance(entries, [], [s], '2026-10-30')).toBe(50);
    expect(creditBalance(entries, [], [{ ...s, status: 'void' }], '2026-10-31')).toBe(50);
    expect(creditBalance(entries, [], [{ ...s, status: 'draft' }], '2026-10-31')).toBe(50);
  });

  it('property: balance = entries + adjustments - settled minutes (all dated in range)', () => {
    const date = fc
      .integer({ min: 1, max: 28 })
      .map((d) => `2026-10-${String(d).padStart(2, '0')}`);
    const signed = fc.integer({ min: -600, max: 600 }).filter((m) => m !== 0);
    fc.assert(
      fc.property(
        fc.array(fc.record({ workDate: date, minutes: signed })),
        fc.array(fc.record({ workDate: date, deltaMin: signed })),
        fc.array(fc.record({ month: fc.constantFrom('2026-08', '2026-09'), appliedMin: signed })),
        (es, as, ss) => {
          const b = creditBalance(
            active(es),
            as.map((a) => ({ ...a, status: 'active' as const })),
            ss.map((s) => ({ ...s, status: 'applied' as const })),
            '2026-10-31',
          );
          const expected =
            sumMin(es) +
            as.reduce((n, a) => n + a.deltaMin, 0) -
            ss.reduce((n, s) => n + s.appliedMin, 0);
          expect(b).toBe(expected);
        },
      ),
    );
  });
});

describe('PRD 14.2 time credits: value and rate', () => {
  it('value is r_day x m / S_std at 1x with one rounding on the net minutes (example 13)', () => {
    expect(creditValue(50, PRIYA)).toBe(4_480);
    expect(creditValue(120, PRIYA) + creditValue(-70, PRIYA)).toBe(4_481);
    expect(creditValue(-130, KAJAL)).toBe(-9_630);
    expect(creditValue(0, KAJAL)).toBe(0);
  });

  it('half up at .5 paise, the same both ways', () => {
    const tiny: MinuteRate = { rDay: { num: 27, den: 1 }, sStd: 540 };
    expect([9, 10, 30, -10, -30].map((m) => creditValue(m, tiny))).toEqual([0, 1, 2, -1, -2]);
  });

  it('a minute is worth the same on a short day: S_std, not S_day (example 15)', () => {
    expect(creditValue(-30, PRIYA)).toBe(-2_688);
    expect(toPaise(mul(frac(1_500_000, 31), frac(30, 300)))).toBe(4_839);
  });

  it('creditRate uses the salary in effect on the last day of the month over S_std', () => {
    expect(creditRate(person(), OCT)).toEqual(PRIYA);
    expect(creditRate(person({}, NOV, 1_200_000), NOV)).toEqual(KAJAL);
    expect(creditRate(meena(), OCT)).toEqual({ rDay: { num: 55_000, den: 1 }, sStd: 540 });
    const raise = person({
      salaryParts: [
        { from: '2026-10-01', to: '2026-10-15', type: 'monthly', amountPaise: 1_500_000 },
        { from: '2026-10-16', to: '2026-10-31', type: 'monthly', amountPaise: 1_550_000 },
      ],
      divisor: 'fixed26',
      stdMin: 480,
    });
    expect(creditRate(raise, OCT)).toEqual({ rDay: { num: 775_000, den: 13 }, sStd: 480 });
  });
});

describe('PRD 14.2 time credits: settlement', () => {
  it.each([
    { name: 'settle 0', b: 50, s: 0, room: 0, rate: PRIYA, out: [0, 0, 50] },
    { name: 'full plus (example 13)', b: 50, s: 50, room: 0, rate: PRIYA, out: [50, 4_480, 0] },
    { name: 'partial plus', b: 50, s: 20, room: 0, rate: PRIYA, out: [20, 1_792, 30] },
    {
      name: 'minus that fits (example 14)',
      b: -150,
      s: -100,
      room: 600_000,
      rate: KAJAL,
      out: [-100, -7_407, -50],
    },
    {
      name: 'the 50% cap trims a cut to whole minutes',
      b: -150,
      s: -100,
      room: 5_000,
      rate: KAJAL,
      out: [-67, -4_963, -83],
    },
    { name: 'no room cuts nothing', b: -150, s: -100, room: 0, rate: KAJAL, out: [0, 0, -150] },
    {
      name: 'minutes worth 0 paise fit in no room',
      b: -20,
      s: -20,
      room: 0,
      rate: { rDay: { num: 27, den: 1 }, sStd: 540 },
      out: [-9, 0, -11],
    },
    {
      name: 'the other sign settles nothing',
      b: -150,
      s: 50,
      room: 0,
      rate: KAJAL,
      out: [0, 0, -150],
    },
    {
      name: 'more than the balance stops at it',
      b: 50,
      s: 80,
      room: 0,
      rate: PRIYA,
      out: [50, 4_480, 0],
    },
    { name: 'zero balance', b: 0, s: -10, room: 100, rate: PRIYA, out: [0, 0, 0] },
    {
      name: 'a zero rate fits any cut',
      b: -10,
      s: -10,
      room: 0,
      rate: { rDay: { num: 0, den: 1 }, sStd: 540 },
      out: [-10, 0, 0],
    },
  ])('$name', ({ b, s, room, rate, out }) => {
    const [appliedMin, amountPaise, stayMin] = out;
    expect(settleCredits({ balanceMin: b, settleMin: s, room, rate })).toEqual({
      appliedMin,
      amountPaise,
      stayMin,
    });
  });

  it('property: |applied| <= |settle| <= |balance|, a cut fits the room and is the largest that does', () => {
    const rate = fc.record({
      rDay: fc.record({
        num: fc.integer({ min: 1, max: 10_000_000 }),
        den: fc.integer({ min: 1, max: 31 }),
      }),
      sStd: fc.integer({ min: 60, max: 600 }),
    });
    fc.assert(
      fc.property(
        fc.integer({ min: -5_000, max: 5_000 }),
        fc.integer({ min: -6_000, max: 6_000 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        rate,
        (b, s, room, r) => {
          const out = settleCredits({ balanceMin: b, settleMin: s, room, rate: r });
          const wanted = Math.sign(s) === Math.sign(b) ? Math.min(Math.abs(s), Math.abs(b)) : 0;
          const a = Math.abs(out.appliedMin);
          expect(a).toBeLessThanOrEqual(wanted);
          expect(out.appliedMin === 0 || Math.sign(out.appliedMin) === Math.sign(b)).toBe(true);
          expect(out.stayMin).toBe(b - out.appliedMin);
          expect(out.amountPaise).toBe(creditValue(out.appliedMin, r));
          if (b > 0) expect(a).toBe(wanted);
          if (b < 0) {
            expect(-out.amountPaise).toBeLessThanOrEqual(room);
            if (a < wanted) expect(creditValue(a + 1, r)).toBeGreaterThan(room);
          }
        },
      ),
    );
  });
});

describe('PRD 7.17.7 legal hours warnings', () => {
  it('warns past 9 h on a day and past 48 h in a Monday-Sunday week; not-employed days are skipped', () => {
    const week = ['05', '06', '07', '08', '09', '10'].map((d) => dr(`2026-10-${d}`));
    const long = dr('2026-10-12', { workedMin: 540, otCandidateMin: 30 });
    const ne = dr('2026-10-13', { dayType: 'NE', status: 'NE', workedMin: 900 });
    expect(legalOvertime([long, ne, ...week])).toEqual([
      { code: 'daily_hours', period: '2026-10-12', minutes: 570 },
      { code: 'weekly_hours', period: isoWeekOf('2026-10-05'), minutes: 3_240 },
    ]);
    expect(legalOvertime(week, { dayMin: 600, weekMin: 3_240 })).toEqual([]);
  });
});

describe('PRD 14.2 time credits: payslip', () => {
  const dates = (month: string, from = '01') =>
    monthOf(month)
      .map((d) => d.workDate)
      .filter((d) => d >= `${month}-${from}`);

  it('on credit days no late/early and no overtime pay; off-day extra is unchanged; the start date splits the month', () => {
    const days = oct([
      dr('2026-10-07', { undertimeMin: 15, lateBillableMin: 15 }),
      dr('2026-10-08', { otCandidateMin: 60 }),
      dr('2026-10-21', { undertimeMin: 20, lateBillableMin: 20 }),
      dr('2026-10-22', { otCandidateMin: 120 }),
      weekOff('2026-10-27', { workedMin: 510, offdayCredit: 1 }),
    ]);
    const r = computePayslip(
      input({
        days,
        approvals: [approve('2026-10-08', 60, 60), approve('2026-10-22', 120, 120)],
        rules: { ...RULES, weekOffWorked: 'extra_pay' },
        creditDays: dates(OCT, '15'),
      }),
    );
    expect(() => PayslipSchema.parse(r)).not.toThrow();
    expect(amount(r, 'undertime')).toBe(-1_344);
    expect(amount(r, 'overtime')).toBe(10_753);
    expect(formula(r, 'overtime')).toBe('₹483.87 × 2 × 60 min ÷ 540');
    expect(amount(r, 'offday_extra')).toBe(48_387);
    expect(r.lines.some((l) => l.code === 'time_credits')).toBe(false);
    expect(r).toMatchObject({ otApprovedMin: 180, credits: null });
  });

  it('comp-off overtime mode earns no comp-off from credit days', () => {
    const days = oct([dr('2026-10-07', { otPreapprovedMin: 480 })]);
    const comp = person({ otRate: { mode: 'comp_off' } });
    expect(computePayslip(input({ person: comp, days })).compOffEarned).toBe(1);
    expect(
      computePayslip(input({ person: comp, days, creditDays: dates(OCT) })).compOffEarned,
    ).toBe(0);
  });

  it('a minus settlement is first in the capped group, before advance recovery', () => {
    const absents = ['02', '04', '05', '06', '07', '09', '11', '12', '13'].map((d) =>
      absent(`2026-11-${d}`),
    );
    const r = computePayslip(
      input({
        person: person({}, NOV, 1_200_000),
        month: NOV,
        days: monthOf(NOV, { days: Object.fromEntries(absents.map((d) => [d.workDate, d])) }),
        advances: [advance(1, 600_000)],
        creditDays: dates(NOV),
        settlement: { balanceMin: -300, settleMin: -300, rate: KAJAL },
      }),
    );
    expect(() => PayslipSchema.parse(r)).not.toThrow();
    expect(r.lines.map((l) => l.code)).toEqual([
      'salary',
      'lop',
      'time_credits',
      'advance_recovery',
    ]);
    expect(amount(r, 'time_credits')).toBe(-22_222);
    expect(formula(r, 'time_credits')).toBe('₹400.00 × 300 min ÷ 540');
    expect(amount(r, 'advance_recovery')).toBe(-(240_000 - 22_222));
    expect(r).toMatchObject({ netPaise: 600_000, credits: { appliedMin: -300, stayMin: 0 } });
  });

  it('the 50% cap trims a cut to whole minutes; the rest stays on the balance with a note', () => {
    const absents = [
      '02',
      '04',
      '05',
      '06',
      '07',
      '09',
      '11',
      '12',
      '13',
      '14',
      '16',
      '18',
      '19',
      '20',
    ];
    const r = computePayslip(
      input({
        person: person({}, NOV, 1_200_000),
        month: NOV,
        days: monthOf(NOV, {
          days: Object.fromEntries(absents.map((d) => [`2026-11-${d}`, absent(`2026-11-${d}`)])),
        }),
        creditDays: dates(NOV),
        settlement: { balanceMin: -900, settleMin: -900, rate: KAJAL },
      }),
    );
    expect(amount(r, 'lop')).toBe(-560_000);
    expect(amount(r, 'time_credits')).toBe(-40_000);
    expect(formula(r, 'time_credits')).toBe(
      '₹400.00 × 540 min ÷ 540 (540 of 900 min fit under the 50% limit)',
    );
    expect(r.credits).toEqual({ appliedMin: -540, amountPaise: -40_000, stayMin: -360 });
    expect(r.warnings).toContainEqual({
      code: 'cap_carry',
      message: '360 min of time credits stay on the balance (50% limit).',
      amountPaise: 26_667,
    });
    expect(r.netPaise).toBe(600_000);
  });

  it('no room at all: no line, everything stays', () => {
    const absents = Array.from(
      { length: 15 },
      (_, i) => `2026-11-${String(i + 2).padStart(2, '0')}`,
    );
    const r = computePayslip(
      input({
        person: person({}, NOV, 1_200_000),
        month: NOV,
        days: monthOf(NOV, {
          weekOffDow: null,
          days: Object.fromEntries(absents.map((d) => [d, absent(d)])),
        }),
        creditDays: dates(NOV),
        settlement: { balanceMin: -60, settleMin: -60, rate: KAJAL },
      }),
    );
    expect(r.lines.some((l) => l.code === 'time_credits')).toBe(false);
    expect(r.credits).toEqual({ appliedMin: 0, amountPaise: 0, stayMin: -60 });
  });

  it('property: with settle 0, pay equals the credits-off pay minus the automatic late/early and overtime amounts', () => {
    const day = fc.record({
      status: fc.constantFrom<'P' | 'H' | 'A'>('P', 'P', 'P', 'H', 'A'),
      ut: fc.integer({ min: 0, max: 120 }),
      ot: fc.integer({ min: 0, max: 240 }),
    });
    fc.assert(
      fc.property(
        fc.array(day, { minLength: 31, maxLength: 31 }),
        fc.integer({ min: -2_000, max: 2_000 }),
        fc.constantFrom(
          { mode: 'multiplier' as const, multiplier: 2 as const },
          { mode: 'flat' as const, paisePerHour: 12_345 },
          { mode: 'unpaid' as const },
        ),
        (spec, balanceMin, otRate) => {
          const days = monthOf(OCT, { weekOffDow: null }).map((d, i) => {
            const s = spec[i] as (typeof spec)[number];
            return dr(d.workDate, {
              status: s.status,
              workedMin: s.status === 'A' ? 0 : 540,
              undertimeMin: s.status === 'P' ? s.ut : 0,
              otCandidateMin: s.ot,
            });
          });
          const approvals = days.map((d) =>
            approve(d.workDate, d.otCandidateMin, d.otCandidateMin),
          );
          const base = input({ person: person({ otRate }), days, approvals });
          const off = computePayslip(base);
          const on = computePayslip({
            ...base,
            creditDays: days.map((d) => d.workDate),
            settlement: { balanceMin, settleMin: 0, rate: PRIYA },
          });
          expect(on.netBeforeRoundingPaise).toBe(
            off.netBeforeRoundingPaise - amount(off, 'undertime') - amount(off, 'overtime'),
          );
          expect(on.credits).toEqual({ appliedMin: 0, amountPaise: 0, stayMin: balanceMin });
          expect(off).toEqual({ ...computePayslip({ ...base, creditDays: [], settlement: null }) });
        },
      ),
      { numRuns: 50 },
    );
  });
});
