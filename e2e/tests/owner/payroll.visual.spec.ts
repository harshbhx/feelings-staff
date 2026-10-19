/**
 * Owner payroll screens (PRD 4.10, 4.13, 4.14, 4.16, 14.5): Payroll list, run review (draft with
 * blockers, finalised), payslip review, Advances and Reports at 390 and 1280, with loading and error
 * states for the run, and axe on each. Mock mode, client clock 10:42 IST on 19 Oct 2026.
 */
import { expect, test } from '../../fixtures';
import { noCrash, OWNER_PROJECTS, openOwner, shown } from './helpers';

const RUN = '01K8QTKPY00JBH9HC76Z45ZRR1';
const PRIYA = '01K86AFQDXWDHQ8238N67SVDDK';

test.describe('owner payroll visual', () => {
  test.beforeEach(({ page: _page }, info) => {
    test.skip(!OWNER_PROJECTS.has(info.project.name), 'owner screens at 390 and 1280 only');
  });

  test('OWN-P payroll list: months with status, people, net and paid (O-13)', async ({
    page,
    checkA11y,
  }) => {
    await openOwner(page, '/o/payroll');
    await expect(shown(page, 'Payroll so far')).toBeVisible();
    await noCrash(page);
    await expect(page).toHaveScreenshot('owner-payroll.png', { fullPage: true });
    await checkA11y();
  });

  test('OWN-P run: blockers, the maroon summary and a table per person (O-13.2)', async ({
    page,
    checkA11y,
  }) => {
    await openOwner(page, `/o/payroll/${RUN}`, ['ownerPayrollGet:with-blockers']);
    await expect(page.getByTestId('payroll-blockers')).toBeVisible();
    await expect(page.getByTestId('payroll-summary')).toBeVisible();
    await noCrash(page);
    await expect(page).toHaveScreenshot('owner-payroll-run.png', { fullPage: true });
    await checkA11y();
  });

  test('OWN-P run: finalised offers Mark all paid and Reopen (O-13.4)', async ({
    page,
    checkA11y,
  }) => {
    await openOwner(page, `/o/payroll/${RUN}`, ['ownerPayrollGet:finalised']);
    await expect(page.getByRole('button', { name: 'Reopen' })).toBeVisible();
    await noCrash(page);
    await expect(page).toHaveScreenshot('owner-payroll-run-final.png', { fullPage: true });
    await checkA11y();
  });

  test('OWN-P run: loading keeps the layout', async ({ page }) => {
    await openOwner(page, `/o/payroll/${RUN}`, ['ownerPayrollGet:loading'], false);
    await expect(page.locator('#owner-main .fs-skeleton').first()).toBeVisible();
    await noCrash(page);
    await expect(page).toHaveScreenshot('owner-payroll-run-loading.png');
  });

  test('OWN-P run: error card in plain words', async ({ page }) => {
    await openOwner(page, `/o/payroll/${RUN}`, ['ownerPayrollGet:error']);
    await expect(page.getByTestId('owner-error')).toBeVisible();
    await noCrash(page);
    await expect(page).toHaveScreenshot('owner-payroll-run-error.png');
  });

  test('OWN-P payslip: every line with its formula, adjustments and recovery (O-13.3)', async ({
    page,
    checkA11y,
  }) => {
    await openOwner(page, `/o/payroll/${RUN}/${PRIYA}`);
    await expect(page.getByTestId('payslip-net')).toBeVisible();
    await noCrash(page);
    await expect(page).toHaveScreenshot('owner-payslip.png', { fullPage: true });
    await checkA11y();
  });

  test('OWN-P advances: balances and the ledger (O-12)', async ({ page, checkA11y }) => {
    await openOwner(page, '/o/advances');
    await expect(shown(page, 'Still to recover')).toBeVisible();
    await noCrash(page);
    await expect(page).toHaveScreenshot('owner-advances.png', { fullPage: true });
    await checkA11y();
  });

  test('OWN-P reports: export cards and recent files (O-15)', async ({ page, checkA11y }) => {
    await openOwner(page, '/o/reports');
    await expect(shown(page, 'Attendance register')).toBeVisible();
    await noCrash(page);
    await expect(page).toHaveScreenshot('owner-reports.png', { fullPage: true });
    await checkA11y();
  });
});
