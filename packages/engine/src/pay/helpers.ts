/**
 * Inputs for computePayslip that the payroll service builds from the database: pay rules from
 * settings, salary parts from salary_history, advance instalments and late fines (PRD 7.9-7.14).
 */
import type {
  AdvancePlan,
  DayResult,
  Divisor,
  OrgSettings,
  PayRules,
  SalaryPart,
  SalaryType,
} from '@fs/contracts';
import { addDays, daysInMonth } from '@fs/contracts';
import { frac, mul, type Q, toPaise } from '../money';

/** PayRules from the org settings (PRD 7.14). The 50% and 3% caps are fixed by the Code on Wages. */
export function payRulesFromSettings(settings: OrgSettings): PayRules {
  const p = settings.pay;
  return {
    offdayMultiplier: p.offdayMultiplier,
    weekOffWorked: p.weekOffWorked,
    sandwich: p.sandwich,
    dailyPaidHolidays: p.dailyPaidHolidays,
    dailyPaidWeekOffs: p.dailyPaidWeekOffs,
    capPct: 50,
    finesCapPct: 3,
    minimumWagePaise: p.minimumWage.enabled ? p.minimumWage.amountPaise : null,
    minimumWageBasis: p.minimumWage.basis,
  };
}

/** Divisor days for a month (PRD 7.13). "Working days" falls back to calendar days when W is 0. */
export function divisorDays(divisor: Divisor, month: string, workingDays: number): number {
  const d = daysInMonth(month);
  const byDivisor: Record<Divisor, number> = {
    calendar: d,
    fixed30: 30,
    fixed26: 26,
    working: workingDays > 0 ? workingDays : d,
  };
  return byDivisor[divisor];
}

/** Exact r_day = M / div for monthly staff, R for daily-wage staff. */
export const dailyRate = (type: SalaryType, amountPaise: number, divisor: number): Q =>
  type === 'monthly' ? frac(amountPaise, divisor) : frac(amountPaise);

export interface SalaryRow {
  effectiveFrom: string;
  type: SalaryType;
  amountPaise: number;
}

/**
 * Salary parts inside a month, split at each `effective_from` (PRD 7.13 "mid-month salary change").
 * The row in force on the 1st covers the month until the next row takes effect.
 */
export function salaryParts(history: readonly SalaryRow[], month: string): SalaryPart[] {
  const start = `${month}-01`;
  const end = `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;
  const rows = [...history].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  const parts: SalaryPart[] = [];
  rows.forEach((row, i) => {
    const next = rows[i + 1];
    const from = row.effectiveFrom > start ? row.effectiveFrom : start;
    const until = next === undefined ? end : addDays(next.effectiveFrom, -1);
    const to = until < end ? until : end;
    if (from <= to) parts.push({ from, to, type: row.type, amountPaise: row.amountPaise });
  });
  return parts;
}

/** Equal instalments; the last one absorbs the paise remainder (PRD 7.10). */
export function instalmentPlan(amountPaise: number, n: number): number[] {
  const base = Math.floor(amountPaise / n);
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? amountPaise - base * (n - 1) : base));
}

const monthIndex = (ym: string) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7));

export interface AdvancePlanInput {
  amountPaise: number;
  plan: AdvancePlan;
  instalmentsN: number | null;
  firstMonth: string;
}

/** The instalment scheduled for `month` (before anything carried in); 0 outside the plan. */
export function advanceInstalment(a: AdvancePlanInput, month: string): number {
  const n = a.plan === 'full' ? 1 : (a.instalmentsN ?? 1);
  return instalmentPlan(a.amountPaise, n)[monthIndex(month) - monthIndex(a.firstMonth)] ?? 0;
}

/**
 * Late fines (PRD 7.9, P1, off by default): every N lates beyond grace on P days is one fine of half a
 * day at r_day. Leftover lates count toward nothing (no partial fines).
 */
export function lateFines(
  days: readonly Pick<DayResult, 'status' | 'lateBillableMin'>[],
  latesPerFine: number,
  rDay: Q,
): { lates: number; count: number; finePaise: number } {
  const lates = days.filter((d) => d.status === 'P' && d.lateBillableMin > 0).length;
  return {
    lates,
    count: Math.floor(lates / latesPerFine),
    finePaise: toPaise(mul(rDay, frac(1, 2))),
  };
}
