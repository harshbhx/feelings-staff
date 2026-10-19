import type {
  Adjustment,
  AdvanceSchedule,
  CarryForward,
  CreditSettlementInput,
  CreditSettlementResult,
  DayCounts,
  DayResult,
  Fine,
  HolidayRule,
  OtDecision,
  PayRules,
  PayslipLine,
  PayslipLineCode,
  PayslipResult,
  PayslipWarning,
  PersonPay,
} from '@fs/contracts';
import { addDays, DAY_MS, daysInMonth, isoWeekOf } from '@fs/contracts';
import { creditValue, settleCredits } from '../credits';
import { sandwichDates } from '../leave';
import {
  add,
  formatInr,
  formatNum,
  formatRate,
  frac,
  fromDecimal,
  minQ,
  mul,
  type Q,
  roundToRupee,
  sub,
  sum,
  toPaise,
  ZERO,
} from '../money';
import { ENGINE_VERSION } from '../version';
import { dailyRate, divisorDays } from './helpers';
import { grouped, plural } from './shared';
import { type PayStatus, type TimeDay, timeLines } from './time';

export * from './helpers';
export * from './time';

export interface ComputePayslipInput {
  person: PersonPay;
  month: string;
  days: DayResult[];
  approvals: OtDecision[];
  advances: AdvanceSchedule[];
  adjustments: Adjustment[];
  fines: Fine[];
  rules: PayRules;
  carryIn: CarryForward;
  /** Org holidays of the month: per-holiday "if worked" choice (default extra pay) and paid flag. */
  holidays?: HolidayRule[];
  /** Warning limits; PRD 7.6 defaults are 48 h a week and 144 h of overtime a quarter. */
  limits?: { weeklyHours: number; quarterlyOtHours: number };
  /** Overtime minutes already paid earlier in this calendar quarter, for the quarterly warning. */
  quarterOtMinBefore?: number;
  /**
   * Dates with Time credits on (PRD 7.17.1, `credits_on(person, date)`): no late/early deduction and
   * no overtime pay on them; their approved overtime is a plus credit instead. Absent: none.
   */
  creditDays?: readonly string[];
  /** The owner's Time credits settlement for this run (PRD 7.17.5); null or absent settles nothing. */
  settlement?: CreditSettlementInput | null;
  /**
   * Legal-band overtime minutes of the month on Time credits days (`legalOtBand`) and the "Pay legal
   * overtime at 2x" setting, for the owner's warnings (PRD 7.17.7). Absent: none.
   */
  legalOt?: { minutes: number; pay2x: boolean };
}

/** The payslip plus what a Time credits settlement applied (null when there was none). */
export type PayslipWithCredits = PayslipResult & { credits: CreditSettlementResult | null };

/** LOP days per status for monthly staff (PRD 7.13: A + 0.5 × H + unpaid leave + sandwich). */
const LOP_WEIGHT: Record<PayStatus, number> = { P: 0, H: 0.5, A: 1, L: 0, LOP: 1, WO: 0, HO: 0 };
/** Paid days per status for daily-wage staff before paid holidays and week-offs. */
const WORK_WEIGHT: Record<PayStatus, number> = { P: 1, H: 0.5, A: 0, L: 1, LOP: 0, WO: 0, HO: 0 };

const LABEL: Record<PayslipLineCode, string> = {
  salary: 'Salary',
  basic: 'Basic wages',
  overtime: 'Overtime',
  offday_extra: 'Extra for off-day work',
  incentive: 'Incentive',
  bonus: 'Bonus',
  other_earning: 'Other earning',
  arrears: 'Arrears',
  lop: 'Loss of pay',
  undertime: 'Late and early',
  statutory: 'Statutory deduction',
  fine: 'Fine',
  damage: 'Damage or loss',
  other_deduction: 'Other deduction',
  recovery: 'Recovery',
  advance_recovery: 'Advance recovery',
  rounding: 'Rounding',
  time_credits: 'Time credits',
};

const EARNING_KINDS = new Set<Adjustment['kind']>([
  'incentive',
  'bonus',
  'other_earning',
  'arrears',
]);
const FINE_LAPSE_DAYS = 90;

const span = (from: string, to: string) =>
  from > to ? 0 : Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS) + 1;
const later = (a: string, b: string) => (a > b ? a : b);
const earlier = (a: string, b: string) => (a < b ? a : b);
const MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
const dayMonth = (date: string) =>
  `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`;

interface Part {
  index: number;
  from: string;
  to: string;
  monthly: boolean;
  amountPaise: number;
  days: number;
  rate: Q;
}

interface Capped {
  code: PayslipLineCode;
  refId: string | null;
  want: number;
  note: string;
}

/**
 * One person's payslip for a month (PRD 7.10, 7.13): salary or basic wages, overtime, off-day extra,
 * adjustments, LOP and late/early in full, then fines, damage, other deductions and advance recovery
 * inside the 50% cap with carry-forward. Every line is rounded once from exact fractions and carries
 * a human formula. `carryIn.advances` is informational: the caller folds carried advances into
 * `AdvanceSchedule.duePaise`. Pre-approved overtime is paid automatically; `auto` decisions are
 * ignored so it is not counted twice.
 *
 * Time credits (PRD 7.13, 7.17): on `creditDays` the late/early and overtime lines are replaced by
 * the owner's `settlement`, one `time_credits` line: a plus settlement is an earning that joins
 * gross pay; a minus one is a cut taken first inside the 50% cap room, trimmed to whole minutes that
 * fit. Without credit days and a settlement the payslip is exactly the one without Time credits.
 */
export function computePayslip(input: ComputePayslipInput): PayslipWithCredits {
  const { person, month, rules } = input;
  const D = daysInMonth(month);
  const monthStart = `${month}-01`;
  const monthEnd = `${month}-${String(D).padStart(2, '0')}`;
  const empFrom = later(monthStart, person.joinDate);
  const empTo = earlier(monthEnd, person.exitDate ?? monthEnd);
  const employedDays = span(empFrom, empTo);
  const div = divisorDays(person.divisor, month, person.workingDays);
  const limits = input.limits ?? { weeklyHours: 48, quarterlyOtHours: 144 };

  const parts: Part[] = person.salaryParts.map((p, index) => {
    const from = later(p.from, empFrom);
    const to = earlier(p.to, empTo);
    return {
      index,
      from,
      to,
      monthly: p.type === 'monthly',
      amountPaise: p.amountPaise,
      days: span(from, to),
      rate: dailyRate(p.type, p.amountPaise, div),
    };
  });
  const last = parts.reduce((_, p) => p);
  const multiPart = parts.length > 1;
  const partFor = (date: string) => parts.find((p) => p.from <= date && date <= p.to);
  const rateText = (p: Part) =>
    p.monthly ? `${formatInr(p.amountPaise)} ÷ ${div} days` : `${formatInr(p.amountPaise)} a day`;

  const holidays = new Map((input.holidays ?? []).map((h) => [h.date, h]));
  const sandwich = new Set(rules.sandwich ? sandwichDates(input.days) : []);
  const creditDays = new Set(input.creditDays ?? []);

  const counts: DayCounts = {
    P: 0,
    H: 0,
    A: 0,
    L: 0,
    LOP: 0,
    WO: 0,
    HO: 0,
    NE: D - employedDays,
    paidDays: 0,
    lopDays: 0,
  };
  const lop = new Map<string, { part: Part; days: number }>();
  const paidDaily = new Map<number, number>();
  const timeDays: TimeDay[] = [];
  const weekMin = new Map<string, number>();
  let lopDaysMonthly = 0;

  for (const d of input.days) {
    const part = d.dayType === 'NE' ? undefined : partFor(d.workDate);
    if (part === undefined) continue;
    // OPEN days count as present (payroll closes them first); sandwiched off days become LOP.
    const open = d.status === 'OPEN' ? (d.dayType === 'work' ? 'P' : d.dayType) : d.status;
    const st = (sandwich.has(d.workDate) ? 'LOP' : open) as PayStatus;
    const holiday = holidays.get(d.workDate);
    const paidOff =
      (st === 'WO' && rules.dailyPaidWeekOffs) ||
      (st === 'HO' && rules.dailyPaidHolidays && (holiday?.paid ?? true));

    counts[st] += 1;
    if (st === 'H' && d.leaveCode !== null && d.leaveCode !== 'LOP') counts.L += 0.5;
    counts.lopDays += LOP_WEIGHT[st];
    if (part.monthly) {
      lopDaysMonthly += LOP_WEIGHT[st];
      grouped(lop, String(part.index), () => ({ part, days: 0 })).days += LOP_WEIGHT[st];
    } else {
      paidDaily.set(
        part.index,
        (paidDaily.get(part.index) ?? 0) + WORK_WEIGHT[st] + Number(paidOff),
      );
    }
    timeDays.push({
      day: d,
      status: st,
      part,
      offPaid: part.monthly || paidOff,
      offMode: d.dayType === 'WO' ? rules.weekOffWorked : (holiday?.workedComp ?? 'extra_pay'),
      credits: creditDays.has(d.workDate),
    });
    const week = isoWeekOf(d.workDate);
    weekMin.set(
      week,
      (weekMin.get(week) ?? 0) +
        (d.totalMin ?? d.workedMin + d.otPreapprovedMin + d.otCandidateMin),
    );
  }

  // Late/early, overtime and off-day extra (PRD 7.5-7.7) as one stage.
  const time = timeLines({
    days: timeDays,
    approvals: input.approvals,
    otRate: person.otRate,
    stdMin: person.stdMin,
    offdayMultiplier: rules.offdayMultiplier,
  });
  const { lateBillableMin, earlyBillableMin, otApprovedMin, otPendingMin } = time;

  const lines: PayslipLine[] = [];
  const push = (
    code: PayslipLineCode,
    kind: PayslipLine['kind'],
    amountPaise: number,
    formula: string,
    refId: string | null = null,
  ) => lines.push({ code, label: LABEL[code], formula, amountPaise, kind, refId });

  // Earnings ------------------------------------------------------------------------------
  let mPro = ZERO;
  let basic = ZERO;
  for (const p of parts) {
    const range = multiPart ? ` (${dayMonth(p.from)} to ${dayMonth(p.to)})` : '';
    if (p.monthly) {
      const amount = mul(frac(p.amountPaise), frac(p.days, D));
      mPro = add(mPro, amount);
      const formula =
        p.days === D
          ? `${formatInr(p.amountPaise)} a month`
          : `${formatInr(p.amountPaise)} × ${p.days}/${D} days`;
      push('salary', 'earning', toPaise(amount), `${formula}${range}`);
    } else {
      const paid = paidDaily.get(p.index) ?? 0;
      const amount = mul(p.rate, fromDecimal(paid));
      basic = add(basic, amount);
      push('basic', 'earning', toPaise(amount), `${rateText(p)} × ${plural(paid, 'day')}${range}`);
    }
  }

  for (const l of time.earnings) push(l.code, 'earning', l.amountPaise, l.formula);

  // Time credits settlement (PRD 7.17.5): a plus one is an earning and joins gross pay.
  const credit = input.settlement ?? null;
  let credits: CreditSettlementResult | null = null;
  const creditFormula = (c: CreditSettlementInput, min: number) =>
    `${formatRate(frac(c.rate.rDay.num, c.rate.rDay.den))} × ${min} min ÷ ${c.rate.sStd}`;
  if (credit !== null && credit.balanceMin >= 0) {
    credits = settleCredits({ ...credit, room: 0 });
    if (credits.appliedMin !== 0) {
      push(
        'time_credits',
        'earning',
        credits.amountPaise,
        creditFormula(credit, credits.appliedMin),
      );
    }
  }

  for (const a of input.adjustments) {
    if (EARNING_KINDS.has(a.kind)) push(a.kind, 'earning', a.amountPaise, a.note, a.id);
  }
  const grossPaise = lines.reduce((s, l) => s + l.amountPaise, 0);

  // Absence and late/early, in full (PRD 7.10 step 1) ------------------------------------
  const lopRaw = sum([...lop.values()].map((t) => mul(t.part.rate, fromDecimal(t.days))));
  const absence = minQ(mPro, lopRaw);
  const absencePaise = toPaise(absence);
  if (absencePaise > 0) {
    const terms = [...lop.values()]
      .filter((t) => t.days > 0)
      .map((t) => `${rateText(t.part)} × ${plural(t.days, 'day')}`)
      .join(' + ');
    const clamped = absence === mPro ? ', no more than the salary for days employed' : '';
    push('lop', 'deduction', -absencePaise, `${terms}${clamped}`);
  }
  const undertime = minQ(time.undertime.amount, sub(add(mPro, basic), absence));
  const undertimePaise = toPaise(undertime);
  if (undertimePaise > 0) push('undertime', 'deduction', -undertimePaise, time.undertime.formula);
  const timePaise = absencePaise + undertimePaise;

  // The 50% cap (PRD 7.10 steps 2-5) -----------------------------------------------------
  const capQ = mul(frac(grossPaise), mul(fromDecimal(rules.capPct), frac(1, 100)));
  const capPaise = Number(capQ.n / capQ.d);
  let room = Math.max(0, capPaise - timePaise);
  const warnings: PayslipWarning[] = [];
  const warn = (code: PayslipWarning['code'], message: string, amountPaise: number | null = null) =>
    warnings.push({ code, message, amountPaise });
  if (timePaise > capPaise) {
    warn(
      'absence_over_cap',
      `Loss of pay and late/early (${formatInr(timePaise)}) are more than half of gross pay, so nothing else is deducted this month.`,
      timePaise,
    );
  }

  // Fines: drop those older than 90 days, then keep at most 3% of gross; the excess is dropped.
  const fineQ = mul(frac(grossPaise), mul(fromDecimal(rules.finesCapPct), frac(1, 100)));
  let fineRoom = Number(fineQ.n / fineQ.d);
  const fines: Array<{ item: Capped; fineId: string; fineDate: string }> = [];
  for (const f of [
    ...input.carryIn.fines.map((c) => ({
      id: c.fineId,
      amountPaise: c.paise,
      fineDate: c.fineDate,
    })),
    ...input.fines,
  ]) {
    if (addDays(f.fineDate, FINE_LAPSE_DAYS) < monthEnd) continue;
    const want = Math.min(f.amountPaise, fineRoom);
    fineRoom -= want;
    const item: Capped = {
      code: 'fine',
      refId: f.id,
      want,
      note: `Fine of ${dayMonth(f.fineDate)}`,
    };
    fines.push({ item, fineId: f.id, fineDate: f.fineDate });
  }
  const carriedIn = (code: PayslipLineCode, paise: number): Capped[] =>
    paise > 0 ? [{ code, refId: null, want: paise, note: 'Carried from last month' }] : [];
  const fromAdjustments = (kinds: Adjustment['kind'][]): Capped[] =>
    input.adjustments
      .filter((a) => kinds.includes(a.kind))
      .map((a) => ({ code: a.kind, refId: a.id, want: a.amountPaise, note: a.note }));

  const take = (item: Capped) => {
    const taken = Math.min(item.want, room);
    room -= taken;
    const carried = item.want - taken;
    if (taken > 0) {
      const formula =
        carried > 0
          ? `${item.note}: ${formatInr(taken)} of ${formatInr(item.want)} fits under the 50% limit`
          : item.note;
      push(item.code, 'deduction', -taken, formula, item.refId);
    }
    return { taken, carried };
  };

  const carryOut: CarryForward = { advances: [], damagePaise: 0, otherPaise: 0, fines: [] };
  let cappedPaise = 0;
  // A minus Time credits settlement is first in the capped group (PRD 7.10 step 3, 7.17.5).
  if (credit !== null && credit.balanceMin < 0) {
    credits = settleCredits({ ...credit, room });
    const cut = -credits.amountPaise;
    const a = -credits.appliedMin;
    const wanted = Math.min(Math.max(0, -credit.settleMin), -credit.balanceMin);
    room -= cut;
    cappedPaise += cut;
    if (a > 0) {
      const fit = a < wanted ? ` (${a} of ${wanted} min fit under the 50% limit)` : '';
      push('time_credits', 'deduction', credits.amountPaise, `${creditFormula(credit, a)}${fit}`);
    }
    if (a < wanted) {
      warn(
        'cap_carry',
        `${wanted - a} min of time credits stay on the balance (50% limit).`,
        creditValue(wanted - a, credit.rate),
      );
    }
  }
  for (const f of fines) {
    const r = take(f.item);
    cappedPaise += r.taken;
    if (r.carried > 0)
      carryOut.fines.push({ fineId: f.fineId, paise: r.carried, fineDate: f.fineDate });
  }
  const groups: Array<['damagePaise' | 'otherPaise', Capped[], string]> = [
    [
      'damagePaise',
      [...carriedIn('damage', input.carryIn.damagePaise), ...fromAdjustments(['damage'])],
      'damage',
    ],
    [
      'otherPaise',
      [
        ...carriedIn('other_deduction', input.carryIn.otherPaise),
        ...fromAdjustments(['other_deduction', 'recovery']),
      ],
      'other deductions',
    ],
  ];
  for (const [key, items, what] of groups) {
    for (const item of items) {
      const r = take(item);
      cappedPaise += r.taken;
      carryOut[key] += r.carried;
    }
    if (carryOut[key] > 0) {
      warn(
        'cap_carry',
        `${formatInr(carryOut[key])} of ${what} moves to next month.`,
        carryOut[key],
      );
    }
  }
  const finesCarried = carryOut.fines.reduce((s, f) => s + f.paise, 0);
  if (finesCarried > 0) {
    warn('cap_carry', `${formatInr(finesCarried)} of fines moves to next month.`, finesCarried);
  }

  const advanceRecoveries: PayslipResult['advanceRecoveries'] = [];
  for (const a of input.advances) {
    const want = a.overridePaise === null ? a.duePaise : Math.min(a.overridePaise, a.duePaise);
    const lowered = a.duePaise - want;
    const note =
      lowered > 0
        ? `${formatInr(want)} of ${formatInr(a.duePaise)} due, lowered for this month`
        : `${formatInr(a.duePaise)} due this month`;
    const r = take({ code: 'advance_recovery', refId: a.advanceId, want, note });
    cappedPaise += r.taken;
    const carriedPaise = r.carried + lowered;
    advanceRecoveries.push({
      advanceId: a.advanceId,
      duePaise: a.duePaise,
      recoveredPaise: r.taken,
      carriedPaise,
    });
    if (carriedPaise > 0) carryOut.advances.push({ advanceId: a.advanceId, paise: carriedPaise });
    if (r.carried > 0) {
      warn('cap_carry', `${formatInr(r.carried)} of the advance moves to next month.`, r.carried);
    }
  }

  // Net and rounding to the rupee (PRD 7.1) -----------------------------------------------
  const deductionsPaise = timePaise + cappedPaise;
  const netBeforeRoundingPaise = grossPaise - deductionsPaise;
  const netPaise = roundToRupee(netBeforeRoundingPaise);
  const roundingPaise = netPaise - netBeforeRoundingPaise;
  if (roundingPaise !== 0) {
    push(
      'rounding',
      'rounding',
      roundingPaise,
      `${formatInr(netBeforeRoundingPaise, true)} rounded to ${formatInr(netPaise)}`,
    );
  }

  // Warnings (never blocks) ----------------------------------------------------------------
  if (rules.minimumWagePaise !== null) {
    const full = last.monthly ? last.amountPaise : last.amountPaise * 26;
    const floor =
      rules.minimumWageBasis === 'monthly' ? rules.minimumWagePaise : rules.minimumWagePaise * 26;
    if (full < floor) {
      warn(
        'min_wage',
        `Full-month pay of ${formatInr(full)} is below the minimum wage of ${formatInr(floor)}.`,
        floor,
      );
    }
  }
  for (const [week, min] of [...weekMin.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (min > limits.weeklyHours * 60) {
      warn(
        'weekly_hours',
        `${formatNum(min / 60)} hours worked in week ${week}, more than ${limits.weeklyHours}.`,
      );
    }
  }
  const quarterMin = (input.quarterOtMinBefore ?? 0) + otApprovedMin;
  if (quarterMin > limits.quarterlyOtHours * 60) {
    warn(
      'quarterly_ot',
      `${formatNum(quarterMin / 60)} hours of overtime this quarter, more than ${limits.quarterlyOtHours}.`,
    );
  }
  const rate = person.otRate;
  if (rate.mode === 'multiplier' && rate.multiplier < 2) {
    warn('ot_multiplier_low', 'Below 2× may not comply with the Code on Wages.');
  }
  if (otPendingMin > 0) {
    warn('pending_overtime', `${otPendingMin} min of overtime not decided, so not paid.`);
  }
  const legal = input.legalOt;
  if (legal !== undefined && legal.minutes > 0) {
    if (legal.pay2x) {
      warn(
        'legal_ot_2x',
        `${legal.minutes} min of overtime beyond 9 h a day or 48 h a week count at 2×, as the law requires.`,
      );
    } else {
      warn(
        'legal_ot_shortfall',
        `Overtime beyond 9 h a day or 48 h a week must be paid at 2× by law. ${legal.minutes} min this month count at 1×.`,
      );
    }
  }

  const monthlyDays = parts.reduce((s, p) => s + (p.monthly ? p.days : 0), 0);
  const dailyPaid = [...paidDaily.values()].reduce((s, n) => s + n, 0);
  counts.paidDays = monthlyDays - lopDaysMonthly + dailyPaid;

  return {
    version: ENGINE_VERSION,
    userId: person.userId,
    month,
    salaryType: last.monthly ? 'monthly' : 'daily',
    daysInMonth: D,
    employedDays,
    divisorDays: div,
    dailyRatePaise: toPaise(last.rate),
    counts,
    lateBillableMin,
    earlyBillableMin,
    otApprovedMin,
    otPendingMin,
    compOffEarned: time.compOffEarned,
    lines,
    grossPaise,
    deductionsPaise,
    netBeforeRoundingPaise,
    roundingPaise,
    netPaise,
    advanceRecoveries,
    carryOut,
    warnings,
    credits,
  };
}
