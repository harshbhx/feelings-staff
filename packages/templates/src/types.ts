/** Translate function the components receive (i18next `t`, or a stub in tests). */
export type T = (key: string, vars?: Record<string, string | number>) => string;

export interface OrgHead {
  name: string;
  address: string | null;
}

/** `2026-10-19` -> `19-10-2026` (PRD 4.16 date format). */
export const dmy = (date: string): string =>
  `${date.slice(8, 10)}-${date.slice(5, 7)}-${date.slice(0, 4)}`;

export interface RegisterRow {
  name: string;
  code: string | null;
  designation: string | null;
  /** One code per day of the month: P, H, A, L, LOP, WO, HO, OD or NE (not employed). */
  cells: string[];
  totals: { P: number; H: number; A: number; L: number; WO: number; HO: number; paid: number };
}

export interface RegisterData {
  org: { name: string; address: string | null };
  month: string;
  dates: string[];
  rows: RegisterRow[];
  generatedAt: number;
}

export interface SalaryRegisterRow {
  name: string;
  code: string | null;
  /** Per-day rate in paise. */
  ratePaise: number;
  paidDays: number;
  salaryPaise: number;
  overtimePaise: number;
  otherEarningsPaise: number;
  lopPaise: number;
  lateEarlyPaise: number;
  advancePaise: number;
  otherDeductionsPaise: number;
  grossPaise: number;
  deductionsPaise: number;
  netPaise: number;
  paid: { on: string; mode: string } | null;
}

export interface SalaryRegisterData {
  org: { name: string; address: string | null };
  month: string;
  revision: number;
  rows: SalaryRegisterRow[];
  generatedAt: number;
}
