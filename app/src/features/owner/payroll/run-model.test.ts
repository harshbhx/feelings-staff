import type { PayrollRunSummary, PayrollRunView } from '@fs/contracts';
import { fixtures, variants } from '@fs/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import {
  blockerCount,
  firstDraftDate,
  personWarnings,
  previousMonth,
  runActions,
  runWord,
  startableMonth,
} from './run-model';

const runs = fixtures.ownerPayrollRuns as PayrollRunSummary[];
const draft = fixtures.ownerPayrollGet as PayrollRunView;
const blocked = variants.ownerPayrollGet?.['with-blockers'] as PayrollRunView;
const finalised = variants.ownerPayrollGet?.finalised as PayrollRunView;

describe('Payroll model (O-13)', () => {
  it('O-13.1 the month to start is last month, once, and the first draft comes on the 1st', () => {
    expect(previousMonth('2026-11-03')).toBe('2026-10');
    expect(previousMonth('2027-01-02')).toBe('2026-12');
    expect(startableMonth(runs, '2026-11-03')).toBeNull();
    expect(startableMonth(runs, '2026-12-01')).toBe('2026-11');
    expect(firstDraftDate('2026-10-19')).toBe('2026-11-01');
    expect(firstDraftDate('2026-12-19')).toBe('2027-01-01');
  });

  it('O-13.2 blockers are counted across kinds before finalising', () => {
    expect(blockerCount(blocked)).toBe(4);
    expect(blockerCount({ blockers: [] })).toBe(0);
  });

  it('O-13.3 a draft can be finalised; a finalised run can be paid and reopened', () => {
    expect(runActions(draft)).toMatchObject({ finalise: true, reopen: false });
    expect(runActions(finalised)).toMatchObject({ finalise: false, reopen: true });
  });

  it('runs read as Draft, Finalised, Paid or Replaced', () => {
    expect(runWord({ status: 'draft', people: 12, paidCount: 0 }).word).toBe('draft');
    expect(runWord({ status: 'finalised', people: 12, paidCount: 3 }).word).toBe('finalised');
    expect(runWord({ status: 'finalised', people: 11, paidCount: 11 }).word).toBe('paid');
    expect(runWord({ status: 'superseded', people: 11, paidCount: 11 }).word).toBe('superseded');
  });
});

describe('Payroll warnings (O-13)', () => {
  it('O-13 review: a payslip warning the run already states for that person is listed once', () => {
    const lines = [
      { user: { name: 'Komal Rathod' }, warnings: ['Below the minimum wage you set'] },
      { user: { name: 'Priya Solanki' }, warnings: ['Below the minimum wage you set'] },
    ];
    const run = ['Komal Rathod is below the minimum wage you set.'];
    expect(personWarnings(lines, run)).toEqual([
      { who: 'Priya Solanki', text: 'Below the minimum wage you set' },
    ]);
    expect(personWarnings(lines, [])).toHaveLength(2);
  });
});
