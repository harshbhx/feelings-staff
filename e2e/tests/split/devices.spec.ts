/**
 * Owner devices on the owner host (docs/owner-access.md "Passkeys" flow 3, slice 5). Runs only in the
 * `split-hosts` project. The approved phone is the test's page; the new device is a second browser
 * context with its own virtual authenticator. Screenshots of the code screen and the approval card are
 * attached to the report.
 */
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { expect, test } from '../../fixtures';
import { enrolFirstDevice, OWNER, shot, virtualAuthenticator } from './owner-kit';

/** The new device: a separate browser (no cookies, its own authenticator) on "Add this device". */
async function newDevice(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await virtualAuthenticator(page);
  await page.goto(`http://${OWNER}/auth/owner`);
  await page.getByRole('button', { name: 'Add this device' }).click();
  await expect(page).toHaveURL(/\/auth\/owner\/add/);
  return { context, page };
}

/** The code the new device shows ("482 913" on screen). */
async function codeOn(page: Page): Promise<string> {
  const card = page.getByTestId('device-code');
  await expect(card).toContainText(/\d{3} \d{3}/);
  const m = (await card.textContent())?.match(/(\d{3}) (\d{3})/);
  if (!m) throw new Error('no code on the new device');
  return `${m[1]} ${m[2]}`;
}

test.describe('SPLIT-4 owner devices', () => {
  test('SPLIT-4.1 a new device asks, the phone approves with fingerprint and PIN, the new device enrols', async ({
    page,
    browser,
    reset,
    outbox,
    checkA11y,
  }) => {
    const s = await reset('basic-salon');
    await virtualAuthenticator(page);
    await enrolFirstDevice(page, s.owner.email, outbox);

    const laptop = await newDevice(browser);
    const code = await codeOn(laptop.page);
    await expect(laptop.page.getByTestId('device-code')).toContainText('Expires in 15 minutes');
    await shot(laptop.page, 'owner-add-device');
    await checkA11y(laptop.page);

    // The approval card on the phone, in Needs action.
    await page.goto(`http://${OWNER}/o/actions`);
    const card = page.getByTestId('action-owner_device');
    await expect(card).toContainText(code);
    await expect(card).toContainText('wants to sign in as you');
    await shot(page, 'owner-device-approval');
    await checkA11y(page);
    await card.getByRole('button', { name: 'Approve' }).click();
    // The fingerprint answers by itself (virtual authenticator); then the owner PIN.
    const sheet = page.getByRole('dialog');
    await sheet.getByLabel('Owner PIN').fill(s.owner.pin ?? '');
    await expect(page.getByText('Approved. Finish on the new device.')).toBeVisible();
    await expect(page.getByTestId('action-owner_device')).toHaveCount(0);

    // The new device notices, then makes its own passkey.
    await expect(
      laptop.page.getByRole('heading', { name: 'Make this phone your key' }),
    ).toBeVisible({ timeout: 15_000 });
    await laptop.page.getByRole('button', { name: 'Make this phone your key' }).click();
    await expect(
      laptop.page.getByRole('heading', { name: 'This phone is your key' }),
    ).toBeVisible();
    await expect(laptop.page.getByLabel('Name of this phone')).toHaveValue("Urmi's computer");
    await laptop.page.getByLabel('Name of this phone').fill('Office laptop');
    await laptop.page.getByRole('button', { name: 'Continue' }).click();
    await expect(laptop.page).toHaveURL(/\/o\/today/);

    // Next time the laptop signs in with its own passkey.
    await laptop.context.clearCookies();
    await laptop.page.goto(`http://${OWNER}/auth/owner`);
    await laptop.page.getByRole('button', { name: 'Use your fingerprint' }).click();
    await expect(laptop.page).toHaveURL(/\/o\/today/);
    await laptop.context.close();
  });

  test('SPLIT-4.2 a declined device is told, and can ask again with a new code', async ({
    page,
    browser,
    reset,
    outbox,
  }) => {
    const s = await reset('basic-salon');
    await virtualAuthenticator(page);
    await enrolFirstDevice(page, s.owner.email, outbox);
    const laptop = await newDevice(browser);
    const first = await codeOn(laptop.page);

    await page.goto(`http://${OWNER}/o/actions`);
    const card = page.getByTestId('action-owner_device');
    await expect(card).toContainText(first);
    await card.getByRole('button', { name: 'Decline' }).click();
    await page
      .getByRole('dialog')
      .getByLabel('Owner PIN')
      .fill(s.owner.pin ?? '');
    await expect(page.getByText('Declined. That device was not added.')).toBeVisible();

    await expect(
      laptop.page.getByText('This device was declined on your other phone.'),
    ).toBeVisible({
      timeout: 15_000,
    });
    await laptop.page.getByRole('button', { name: 'Ask again' }).click();
    const second = await codeOn(laptop.page);
    await page.reload();
    await expect(page.getByTestId('action-owner_device')).toContainText(second);
    await laptop.context.close();
  });
});
