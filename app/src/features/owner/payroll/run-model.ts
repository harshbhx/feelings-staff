/**
 * Payroll view model (PRD 4.13, O-13): which month can be started, the status word for a run, the
 * blockers count and whether finalising needs the "anyway" confirm.
 */
import type { PayrollRunSummary, PayrollRunView } from '@fs/contracts';
import type { DayStatus } from '@fs/ui';

/** The month before `today`'s month ("2026-11-03" -> "2026-10"). */
export function previousMonth(today: string): string {
  const [y, m] = today.split('-').map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** The month that can be started now: last month, unless a run for it already exists. */
export function startableMonth(runs: readonly PayrollRunSummary[], today: string): string | null {
  const month = previousMonth(today);
  return runs.some((r) => r.month === month) ? null : month;
}

/** The 1st of next month, when the cron makes the first draft ("Your first payroll will be ready on 1 Nov"). */
export function firstDraftDate(today: string): string {
  const [y, m] = today.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

export type RunWord = 'draft' | 'finalised' | 'paid' | 'superseded';

/** Status of a run in one word with its chip: Draft, Finalised, Paid, Replaced. */
export function runWord(run: Pick<PayrollRunSummary, 'status' | 'people' | 'paidCount'>): {
  word: RunWord;
  chip: DayStatus;
} {
  if (run.status === 'superseded') return { word: 'superseded', chip: 'off' };
  if (run.status === 'draft') return { word: 'draft', chip: 'waiting' };
  if (run.people > 0 && run.paidCount >= run.people) return { word: 'paid', chip: 'present' };
  return { word: 'finalised', chip: 'flag' };
}

/** Open items across every blocker (PRD 4.13.2). */
export function blockerCount(view: Pick<PayrollRunView, 'blockers'>): number {
  return view.blockers.reduce((n, b) => n + b.count, 0);
}

/** What the run screen offers: finalise (draft), mark paid, reopen (finalised), nothing (preview). */
export function runActions(view: Pick<PayrollRunView, 'run' | 'lines'>) {
  const { run } = view;
  const draft = run.status === 'draft' && !run.preview;
  const final = run.status === 'finalised';
  const unpaid = view.lines.some((l) => l.paid === null && l.payslipId !== null);
  return { finalise: draft, recompute: draft, markAllPaid: final && unpaid, reopen: final };
}
