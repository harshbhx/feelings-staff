/**
 * Time credits screens (PRD 4.19, 14.5, O-29): the Credits list, a person's ledger with the adjust
 * and entry sheets, the Credits tab on the staff profile, the payroll Settle credits step (draft and
 * final), and Settings -> Time credits, at 390 and 1280 with axe. Mock mode, client clock 10:42 IST
 * on 19 Oct 2026. The flow checks (O-29.4, O-29.7, O-29.10) use the same fixtures; the API-driven
 * E2E-23 needs a seeded credits month and follows with the credits API.
 */
import { expect, test } from '../../fixtures';
import { noCrash, OWNER_PROJECTS, openOwner, shown } from './helpers';

/** Fixture ids: Jinal (minus balance, ownerCredits.json), the October run, Priya's profile. */
const JINAL = '01K87R133CAYV58WCHEDPSC8TQ';
const RUN = '01K8QTKPY00JBH9HC76Z45ZRR1';
const PRIYA = '01K86AFQDXWDHQ8238N67SVDDK';

test.describe('owner credits visual', () => {
  test.beforeEach(({ page: _page }, info) => {
    test.skip(!OWNER_PROJECTS.has(info.project.name), 'owner screens at 390 and 1280 only');
  });

  test('OWN-C credits: balances with money, last settlement and away chip (O-29.7)', async ({
    page,
    checkA11y,
  }) => {
    await openOwner(page, '/o/credits');
    await expect(shown(page, 'Jinal Kotak')).toBeVisible();
    await expect(shown(page, 'might cut around ₹96')).toBeVisible();
    await noCrash(page);
    await expect(page).toHaveScreenshot('owner-credits.png', { fullPage: true });
    await checkA11y();
  });

  test('OWN-C credits: loading keeps the layout', async ({ page }) => {
    await openOwner(page, '/o/credits', ['ownerCredits:loading'], false);
    await expect(page.locator('#owner-main .fs-skeleton').first()).toBeVisible();
    await noCrash(page);
    await expect(page).toHaveScreenshot('owner-credits-loading.png');
  });

  test('OWN-C credits: error card in plain words', async ({ page }) => {
    await openOwner(page, '/o/credits', ['ownerCredits:error']);
    await expect(page.getByTestId('owner-error')).toBeVisible();
    await noCrash(page);
    await expect(page).toHaveScreenshot('owner-credits-error.png');
  });

  test('OWN-C ledger: balance, carried over, filters and entries (O-29.7)', async ({
    page,
    checkA11y,
  }) => {
    await openOwner(page, `/o/credits/${JINAL}`);
    await expect(page.getByTestId('credits-balance')).toBeVisible();
    await expect(
      shown(page, 'Nothing is cut or paid until you settle it at payroll.'),
    ).toBeVisible();
    await noCrash(page);
    await expect(page).toHaveScreenshot('owner-credits-ledger.png', { fullPage: true });
    await checkA11y();
  });

  test('OWN-C ledger: Adjust minutes asks for the day, kind, minutes and a reason', async ({
    page,
    checkA11y,
  }) => {
    await openOwner(page, `/o/credits/${JINAL}`);
    await noCrash(page);
    await page.getByRole('button', { name: 'Adjust minutes' }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('button', { name: 'Save adjustment' })).toBeDisabled();
    await sheet.getByLabel('Minutes', { exact: true }).fill('10');
    await sheet.getByLabel('Reason', { exact: true }).fill('Bus strike, she called ahead');
    await expect(sheet.getByRole('button', { name: 'Save adjustment' })).toBeEnabled();
    await expect(page).toHaveScreenshot('owner-credits-adjust.png');
    await checkA11y();
  });

  test('OWN-C ledger: an adjusted entry shows its history with change and void (O-29.10)', async ({
    page,
    checkA11y,
  }) => {
    await openOwner(page, `/o/credits/${JINAL}`);
    await noCrash(page);
    await page
      .getByRole('button', { name: /Early on .*\b5 Oct/ })
      .filter({ visible: true })
      .first()
      .click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByText('Approved by Urmi')).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Void' })).toBeVisible();
    await expect(page).toHaveScreenshot('owner-credits-entry.png');
    await checkA11y();
    await sheet.getByRole('button', { name: 'Void' }).click();
    await expect(sheet.getByRole('button', { name: 'Void adjustment' })).toBeDisabled();
    await sheet.getByLabel('Why void it?', { exact: true }).fill('Typed the wrong day');
    await expect(sheet.getByRole('button', { name: 'Void adjustment' })).toBeEnabled();
  });

  test('OWN-C profile: the Credits tab shows the same ledger', async ({ page, checkA11y }) => {
    await openOwner(page, `/o/staff/${PRIYA}?tab=credits`);
    await expect(page.getByTestId('credits-balance')).toBeVisible();
    await noCrash(page);
    await expect(page).toHaveScreenshot('owner-profile-credits.png', { fullPage: true });
    await checkA11y();
  });

  test('OWN-C settle: one row per balance with stepper, money and balance after (O-29.4)', async ({
    page,
    checkA11y,
  }) => {
    await openOwner(page, `/o/payroll/${RUN}/credits`);
    await expect(page.getByTestId('settle-row')).toHaveCount(2);
    await noCrash(page);
    await expect(page).toHaveScreenshot('owner-credits-settle.png', { fullPage: true });
    await checkA11y();
  });

  test('OWN-C settle: a final run shows what was settled', async ({ page }) => {
    await openOwner(page, `/o/payroll/${RUN}/credits`, ['ownerPayrollGet:finalised']);
    await expect(shown(page, 'This payroll is final. Reopen it to change these.')).toBeVisible();
    await noCrash(page);
    await expect(page).toHaveScreenshot('owner-credits-settle-final.png', { fullPage: true });
  });

  test('OWN-C settings: Time credits with its start date and legal overtime at 2x', async ({
    page,
    checkA11y,
  }) => {
    await openOwner(page, '/o/settings/credits');
    await expect(shown(page, 'Pay legal overtime at 2×')).toBeVisible();
    await noCrash(page);
    await expect(page).toHaveScreenshot('owner-settings-credits.png', { fullPage: true });
    await checkA11y();
  });
});

test.describe('owner credits flows on the fixtures', () => {
  test.beforeEach(({ page: _page }, info) => {
    test.skip(info.project.name !== 'owner-phone', 'flow checks run once, on the phone');
  });

  test('O-29.4 the step keeps the saved choice, Suggested is the full balance, 0 clears it', async ({
    page,
  }) => {
    await openOwner(page, `/o/payroll/${RUN}/credits`);
    const jinal = page.getByTestId('settle-row').filter({ hasText: 'Jinal Kotak' });
    const neha = page.getByTestId('settle-row').filter({ hasText: 'Neha Parmar' });
    // Saved: Jinal settles -100 of -150; Neha nothing (default 0).
    await expect(jinal.getByLabel('Minutes to settle for Jinal Kotak')).toHaveValue('100');
    await expect(jinal.getByTestId('settle-money')).toHaveText('−₹74.07');
    await expect(neha.getByLabel('Minutes to settle for Neha Parmar')).toHaveValue('0');
    await expect(page.getByRole('button', { name: 'Save settlements' })).toBeDisabled();
    // Suggested = the full balance, at the run's rate until saved.
    await jinal.getByRole('button', { name: 'Suggested 150' }).click();
    await expect(jinal.getByLabel('Minutes to settle for Jinal Kotak')).toHaveValue('150');
    await expect(jinal.getByTestId('settle-money')).toHaveText('about −₹111.11');
    await expect(jinal.getByText('Not saved yet')).toBeVisible();
    // The stepper never passes the balance (+ stays focusable but disabled); 0 clears it.
    await expect(jinal.getByRole('button', { name: '5 min more' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await jinal.getByRole('button', { name: '5 min less' }).click();
    await expect(jinal.getByLabel('Minutes to settle for Jinal Kotak')).toHaveValue('145');
    await jinal.getByRole('button', { name: 'Settle 0' }).click();
    await expect(jinal.getByLabel('Minutes to settle for Jinal Kotak')).toHaveValue('0');
    await expect(page.getByRole('button', { name: 'Save settlements' })).toBeEnabled();
  });

  test('O-29.4 a cut trimmed by the cap says what stays on the balance', async ({ page }) => {
    await openOwner(page, `/o/payroll/${RUN}/credits`);
    const jinal = page.getByTestId('settle-row').filter({ hasText: 'Jinal Kotak' });
    await jinal.getByRole('button', { name: 'Suggested 150' }).click();
    await page.getByRole('button', { name: 'Save settlements' }).click();
    // The fixture answer applies -100 of the chosen -150: the cap keeps 50 min on the balance.
    await expect(jinal.getByText('50 min stay on the balance')).toBeVisible();
    await expect(jinal.getByTestId('settle-money')).toHaveText('−₹74.07');
  });

  test('O-29.7 the Credits list filters plus or minus and opens the ledger', async ({ page }) => {
    await openOwner(page, '/o/credits');
    // The radio covers the whole chip.
    await page.getByRole('radio', { name: /plus/ }).click();
    await expect(shown(page, 'Neha Parmar')).toBeVisible();
    await expect(page.locator('#owner-main').getByText('Jinal Kotak')).toHaveCount(0);
    await page.getByRole('radio', { name: /everyone/ }).click();
    await shown(page, 'Jinal Kotak').click();
    await expect(page).toHaveURL(new RegExp(`/o/credits/${JINAL}`));
    await expect(page.getByTestId('credits-balance')).toBeVisible();
  });

  test('O-29.7 Export CSV makes the ledger file for one month', async ({ page }) => {
    await openOwner(page, `/o/credits/${JINAL}`);
    await page.getByRole('button', { name: 'Export CSV' }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByLabel('Month', { exact: true })).toHaveValue('2026-10');
    await sheet.getByRole('button', { name: 'Make file' }).click();
    await expect(
      page.getByText('Making the file. You will find it in Reports.', { exact: true }),
    ).toBeVisible();
  });
});
