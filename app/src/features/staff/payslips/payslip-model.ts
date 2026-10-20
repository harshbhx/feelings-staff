/**
 * What a staff member sees of a payslip (PRD 4.14, 7.17.9). A Time credits settlement shows only
 * as "Time adjustment" with its amount: no minutes, no balance, no formula, never the word
 * "credits". The API already sends the staff view this way; the model also guards the screen.
 */
import type { PayslipLine, PayslipView } from '@fs/contracts';

export interface PayslipRow {
  key: string;
  /** `adjustment` rows take their label and note from the copy catalog. */
  kind: 'line' | 'adjustment';
  label: string;
  /** How the amount was worked out; null for adjustments. */
  formula: string | null;
  /** Paise, positive; the section says whether it is added or taken off. */
  amountPaise: number;
}

const CREDITS = /credit/i;

export function isAdjustment(l: PayslipLine): boolean {
  return l.code === 'time_credits' || CREDITS.test(l.label) || CREDITS.test(l.formula);
}

function row(l: PayslipLine, i: number): PayslipRow {
  const adjustment = isAdjustment(l);
  return {
    key: `${l.code}-${l.refId ?? i}`,
    kind: adjustment ? 'adjustment' : 'line',
    label: adjustment ? '' : l.label,
    formula: adjustment ? null : l.formula,
    amountPaise: Math.abs(l.amountPaise),
  };
}

export interface StaffPayslipSections {
  earnings: PayslipRow[];
  deductions: PayslipRow[];
  rounding: PayslipRow[];
}

export function payslipSections(view: PayslipView): StaffPayslipSections {
  const lines = view.result.lines;
  const pick = (kind: PayslipLine['kind']) =>
    lines.flatMap((l, i) => (l.kind === kind ? [row(l, i)] : []));
  return { earnings: pick('earning'), deductions: pick('deduction'), rounding: pick('rounding') };
}

/** Payslips newest month first; a superseded revision sits after the one that replaced it. */
export function sortPayslips<T extends { month: string; revision: number }>(
  list: readonly T[],
): T[] {
  return [...list].sort((a, b) => b.month.localeCompare(a.month) || b.revision - a.revision);
}
