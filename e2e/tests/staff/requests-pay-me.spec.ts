/**
 * Staff slice 2 (PRD 4.9, 4.11, 4.14, 10.6, 11.9; AC S-12, S-13, S-14, S-16, S-17; E2E-22): leave
 * and fix forms, payslips, My data, Privacy and the language switch. Mock mode (`?mock=1`,
 * fixtures from packages/contracts) with the client clock fixed at 10:42 IST on 19 Oct 2026.
 */
import type { Page, TestInfo } from '@playwright/test';
import { expect, test, VISUAL_NOW } from '../../fixtures';

function staffOnly(info: TestInfo): void {
  test.skip(!info.project.name.startsWith('staff-'), 'staff screens run on the staff projects');
}

async function open(page: Page, path: string, extra = ''): Promise<void> {
  await page.clock.setFixedTime(VISUAL_NOW);
  const [base, query = ''] = path.split('?');
  const q = new URLSearchParams(query);
  q.set('mock', '1');
  q.set('allowBrowser', '1');
  await page.goto(`${base}?${q}${extra}`);
}

const h1 = (page: Page, name: string | RegExp) => page.getByRole('heading', { level: 1, name });

test.describe('leave form', () => {
  test('S-12.2 the dates show counted days and skipped week-offs before sending', async ({
    page,
    checkA11y,
  }, info) => {
    staffOnly(info);
    await open(page, '/requests/leave');
    await expect(h1(page, 'Ask for leave')).toBeVisible();
    await page.getByLabel('From', { exact: true }).fill('2026-11-02');
    await page.getByLabel('To', { exact: true }).fill('2026-11-03');
    await expect(page.getByTestId('leave-counted')).toHaveText('1 day counted.');
    await expect(page.getByText("3 Nov isn't counted (week off).")).toBeVisible();
    await checkA11y();
  });

  test('S-12.1 S-12.2 sending without dates says what is missing and sends nothing', async ({
    page,
  }, info) => {
    staffOnly(info);
    await open(page, '/requests/leave');
    await expect(h1(page, 'Ask for leave')).toBeVisible();
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByText('Pick the dates first.').first()).toBeVisible();
    await expect(page).toHaveURL(/\/requests\/leave/);
  });

  test('S-12 unpaid leave needs a reason; then Send returns to Requests', async ({
    page,
  }, info) => {
    staffOnly(info);
    await open(page, '/requests/leave');
    await expect(h1(page, 'Ask for leave')).toBeVisible();
    await page.getByRole('radio', { name: 'Unpaid' }).check();
    await page.getByLabel('From', { exact: true }).fill('2026-11-02');
    await page.getByLabel('To', { exact: true }).fill('2026-11-03');
    await expect(page.getByTestId('leave-counted')).toBeVisible();
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByText('Write a short reason for unpaid leave.')).toBeVisible();
    await page.getByLabel(/^Reason/).fill('Family function');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page).toHaveURL(/\/requests(\?|$)/);
    await expect(
      page.locator('.fs-toast__title', { hasText: 'Sent. Urmi will let you know.' }),
    ).toBeVisible();
  });
});

test.describe('fix a day form', () => {
  test('S-13.1 forgot to check in: time and reason are required, then Send', async ({
    page,
    checkA11y,
  }, info) => {
    staffOnly(info);
    await open(page, '/requests/fix', '&date=2026-10-19');
    await expect(h1(page, 'Fix a day')).toBeVisible();
    await checkA11y();
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByText('Pick the time.')).toBeVisible();
    await expect(page.getByText('Write a short reason.')).toBeVisible();
    await page.getByLabel('Time you arrived').fill('10:05');
    await page.getByLabel(/^Tell Urmi what happened/).fill('My phone had no battery');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page).toHaveURL(/\/requests\?tab=fixes/);
    await expect(
      page.locator('.fs-toast__title', { hasText: 'Sent. Urmi will let you know.' }),
    ).toBeVisible();
  });

  test('S-13.2 times before 04:00 are refused in words', async ({ page }, info) => {
    staffOnly(info);
    await open(page, '/requests/fix', '&date=2026-10-19');
    await expect(h1(page, 'Fix a day')).toBeVisible();
    await page.getByLabel('Time you arrived').fill('03:30');
    await page.getByLabel(/^Tell Urmi what happened/).fill('Early start');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByText('Pick a time between 04:00 and 23:59.')).toBeVisible();
    await expect(page).toHaveURL(/\/requests\/fix/);
  });

  test('S-13 a venue fix asks where, and when you left must follow when you arrived', async ({
    page,
  }, info) => {
    staffOnly(info);
    await open(page, '/requests/fix', '&date=2026-10-19');
    await page.getByRole('radio', { name: 'Worked at a venue' }).check();
    await page.getByLabel('Where were you?').fill('Patel wedding');
    await page.getByLabel('Time you arrived').fill('14:00');
    await page.getByLabel('Time you left').fill('13:00');
    await page.getByLabel(/^Tell Urmi what happened/).fill('Bridal booking');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(
      page.getByText('The time you left must be after the time you arrived.'),
    ).toBeVisible();
  });
});

test.describe('payslips', () => {
  test('S-14.1 the list shows each month with its net pay and paid date', async ({
    page,
    checkA11y,
  }, info) => {
    staffOnly(info);
    await open(page, '/payslips');
    await expect(h1(page, 'Payslips')).toBeVisible();
    await expect(page.getByRole('link', { name: /October 2026 · ₹/ })).toBeVisible();
    await checkA11y();
  });

  test('S-14.1 no payslips yet says when the first one comes', async ({ page }, info) => {
    staffOnly(info);
    await open(page, '/payslips', '&variant=mePayslips:empty');
    await expect(
      page.getByText('Your first payslip will appear here after the month closes.'),
    ).toBeVisible();
  });

  test('S-14.2 S-14.3 a payslip shows its lines, Download PDF and Share, and never credits', async ({
    page,
    checkA11y,
  }, info) => {
    staffOnly(info);
    await open(page, '/payslips');
    await page
      .getByRole('link', { name: /October 2026 · ₹/ })
      .first()
      .click();
    await expect(h1(page, 'October 2026')).toBeVisible();
    await expect(page.getByTestId('payslip-net')).toContainText('₹');
    await expect(page.getByRole('link', { name: 'Download PDF' })).toHaveAttribute(
      'href',
      /\/payslips\/.+\/pdf$/,
    );
    await expect(page.getByRole('button', { name: 'Share' })).toBeVisible();
    // PRD 7.17.9: a settlement is only ever "Time adjustment"; no minutes, balance or credits.
    await expect(page.locator('main')).not.toContainText(/credit/i);
    await checkA11y();
  });
});

test.describe('me, my data and privacy', () => {
  test('S-17.1 Me shows who I am, the language choice, this phone and the way out', async ({
    page,
    checkA11y,
  }, info) => {
    staffOnly(info);
    await open(page, '/me');
    await expect(h1(page, 'Me')).toBeVisible();
    await expect(page.getByRole('radio', { name: 'English' })).toBeChecked();
    await expect(page.getByRole('radio', { name: 'ગુજરાતી' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'My data' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Privacy notice' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
    await checkA11y();
  });

  test('E2E-22 S-17.2 S-17.3 switching to Gujarati changes the page language at once and falls back to English until the translations arrive', async ({
    page,
    checkA11y,
  }, info) => {
    staffOnly(info);
    await open(page, '/me');
    await expect(h1(page, 'Me')).toBeVisible();
    await page.getByRole('radio', { name: 'ગુજરાતી' }).click();
    await expect(page.getByRole('radio', { name: 'ગુજરાતી' })).toBeChecked();
    await expect(page.locator('html')).toHaveAttribute('lang', 'gu-IN');
    // Gujarati strings ship in 1.1: every missing key shows its English text, no raw keys.
    await expect(h1(page, 'Me')).toBeVisible();
    await expect(page.locator('body')).not.toContainText('staff:');
    await checkA11y();
    await page.getByRole('radio', { name: 'English' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en-IN');
  });

  test('S-16 My data lists check-ins with the location result, consents and who to ask', async ({
    page,
    checkA11y,
  }, info) => {
    staffOnly(info);
    await open(page, '/me/data');
    await expect(h1(page, 'My data')).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: 'Check-ins and check-outs' }),
    ).toBeVisible();
    await expect(page.getByText('Inside').first()).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'What you agreed to' })).toBeVisible();
    await expect(page.getByText(/Urmi Mengar/)).toBeVisible();
    await expect(page.locator('main')).not.toContainText(/credit/i);
    await checkA11y();
  });

  test('S-16 the privacy notice explains the data and offers the photo consent choice', async ({
    page,
    checkA11y,
  }, info) => {
    staffOnly(info);
    await open(page, '/me/privacy');
    await expect(h1(page, 'Privacy notice')).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: 'When we check your location' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Your choices' })).toBeVisible();
    await checkA11y();
  });
});
