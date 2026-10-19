/** Builders for payslip tests: synthetic day results, people and inputs (PRD 7.15 setups). */
import type {
  CarryForward,
  DayResult,
  PayRules,
  PayslipLineCode,
  PayslipResult,
  PersonPay,
} from '@fs/contracts';
import { DEFAULT_ORG_SETTINGS, monthDates, weekday } from '@fs/contracts';
import { type ComputePayslipInput, computePayslip, payRulesFromSettings } from '../src/pay';
import { ENGINE_VERSION } from '../src/version';
import { USER } from './fixtures';

export const OCT = '2026-10';
export const NOV = '2026-11';

/** A plain present full day; override any field. */
export function dr(workDate: string, over: Partial<DayResult> = {}): DayResult {
  return {
    version: ENGINE_VERSION,
    userId: USER,
    workDate,
    dayType: 'work',
    templateId: null,
    scheduledMin: 540,
    workedMin: 540,
    breakMin: 60,
    lateMin: 0,
    lateBillableMin: 0,
    earlyMin: 0,
    earlyBillableMin: 0,
    overbreakMin: 0,
    makeupMin: 0,
    undertimeMin: 0,
    otPreapprovedMin: 0,
    otCandidateMin: 0,
    status: 'P',
    leaveCode: null,
    offdayCredit: 0,
    offdayOtMin: 0,
    tags: [],
    firstInTs: null,
    lastOutTs: null,
    open: false,
    ...over,
  };
}

export const absent = (date: string) => dr(date, { status: 'A', workedMin: 0, breakMin: 0 });
export const weekOff = (date: string, over: Partial<DayResult> = {}) =>
  dr(date, { dayType: 'WO', status: 'WO', scheduledMin: 0, workedMin: 0, breakMin: 0, ...over });
export const holiday = (date: string, over: Partial<DayResult> = {}) =>
  dr(date, { dayType: 'HO', status: 'HO', scheduledMin: 0, workedMin: 0, breakMin: 0, ...over });
export const notEmployed = (date: string) =>
  dr(date, { dayType: 'NE', status: 'NE', scheduledMin: 0, workedMin: 0, breakMin: 0 });

export interface MonthOpts {
  /** Weekly off weekday (default Tuesday, like Priya). */
  weekOffDow?: number | null;
  /** First and last employed dates; other dates are NE. */
  from?: string;
  to?: string;
  /** Per-date overrides, applied last. */
  days?: Record<string, DayResult>;
}

/**
 * A month of present days: full days (540 min), Sundays on the Sunday template (180 min), the weekly
 * off as WO, dates outside employment as NE. That is 48 hours a week, so no weekly warning.
 */
export function monthOf(month: string, o: MonthOpts = {}): DayResult[] {
  const off = o.weekOffDow === undefined ? 2 : o.weekOffDow;
  return monthDates(month).map((date) => {
    const set = o.days?.[date];
    if (set !== undefined) return set;
    if ((o.from !== undefined && date < o.from) || (o.to !== undefined && date > o.to)) {
      return notEmployed(date);
    }
    if (weekday(date) === off) return weekOff(date);
    if (weekday(date) === 0) return dr(date, { scheduledMin: 180, workedMin: 180, breakMin: 0 });
    return dr(date);
  });
}

export function person(
  over: Partial<PersonPay> = {},
  month = OCT,
  amountPaise = 1_500_000,
): PersonPay {
  return {
    userId: USER,
    joinDate: '2025-04-01',
    exitDate: null,
    salaryParts: [
      {
        from: `${month}-01`,
        to: `${month}-${month === NOV ? '30' : '31'}`,
        type: 'monthly',
        amountPaise,
      },
    ],
    divisor: 'calendar',
    otRate: { mode: 'multiplier', multiplier: 2 },
    stdMin: 540,
    workingDays: 27,
    ...over,
  };
}

/** Meena: daily wage ₹550. */
export const meena = (over: Partial<PersonPay> = {}) =>
  person({
    salaryParts: [{ from: '2026-10-01', to: '2026-10-31', type: 'daily', amountPaise: 55_000 }],
    ...over,
  });

export const RULES: PayRules = payRulesFromSettings(DEFAULT_ORG_SETTINGS);
export const NO_CARRY: CarryForward = { advances: [], damagePaise: 0, otherPaise: 0, fines: [] };

export function input(over: Partial<ComputePayslipInput> = {}): ComputePayslipInput {
  return {
    person: person(),
    month: OCT,
    days: monthOf(OCT),
    approvals: [],
    advances: [],
    adjustments: [],
    fines: [],
    rules: RULES,
    carryIn: NO_CARRY,
    ...over,
  };
}

export const slip = (over: Partial<ComputePayslipInput> = {}) => computePayslip(input(over));

/** Days of October with some dates replaced. */
export const oct = (days: DayResult[], o: Omit<MonthOpts, 'days'> = {}) =>
  monthOf(OCT, { ...o, days: Object.fromEntries(days.map((d) => [d.workDate, d])) });

/** Sum of the line amounts with a code. */
export const amount = (r: PayslipResult, code: PayslipLineCode) =>
  r.lines.filter((l) => l.code === code).reduce((s, l) => s + l.amountPaise, 0);

export const formula = (r: PayslipResult, code: PayslipLineCode) =>
  r.lines.find((l) => l.code === code)?.formula;

export const adj = (
  id: number,
  kind: ComputePayslipInput['adjustments'][number]['kind'],
  amountPaise: number,
  note = 'Note',
) => ({ id: `01J0000000000000000000A${String(id).padStart(3, '0')}`, kind, amountPaise, note });

export const advance = (id: number, duePaise: number, overridePaise: number | null = null) => ({
  advanceId: `01J0000000000000000000V${String(id).padStart(3, '0')}`,
  duePaise,
  overridePaise,
});

export const approve = (workDate: string, candidateMin: number, approvedMin: number) => ({
  workDate,
  candidateMin,
  approvedMin,
  decision:
    approvedMin === 0
      ? ('rejected' as const)
      : approvedMin < candidateMin
        ? ('partial' as const)
        : ('approved' as const),
});
