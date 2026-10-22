/**
 * Settings, Security, Devices on the owner host (docs/owner-access.md "Passkeys" flow 4, slice 6).
 * Runs only in the `split-hosts` project. The phone is the test's page; a second browser context with
 * its own virtual authenticator is added through the approval card, renamed and removed. A screenshot
 * of the device list is attached to the report.
 */
import { expect, test } from '../../fixtures';
import {
  codeOn,
  enrolFirstDevice,
  newDevice,
  OWNER,
  shot,
  virtualAuthenticator,
} from './owner-kit';

test.describe('SPLIT-5 owner devices in Settings, Security', () => {
  test('SPLIT-5.1 list, rename, remove with the fingerprint, and never the last device', async ({
    page,
    browser,
    reset,
    outbox,
    checkA11y,
  }) => {
    const s = await reset('basic-salon');
    await virtualAuthenticator(page);
    await enrolFirstDevice(page, s.owner.email, outbox);

    // One device: Remove is disabled and says why.
    await page.goto(`http://${OWNER}/o/settings/security`);
    const section = page.getByRole('region', { name: 'Passkey devices' });
    const row = (name: string) => section.getByRole('listitem').filter({ hasText: name });
    await expect(row('Front desk phone')).toBeVisible();
    await expect(section.getByText('This device')).toBeVisible();
    await expect(section.getByRole('button', { name: 'Remove Front desk phone' })).toBeDisabled();
    await expect(section.getByText('Add another device first.')).toBeVisible();

    // A second device, approved on the phone with the fingerprint and the PIN.
    const laptop = await newDevice(browser);
    const code = await codeOn(laptop.page);
    await page.goto(`http://${OWNER}/o/actions`);
    const card = page.getByTestId('action-owner_device');
    await expect(card).toContainText(code);
    await card.getByRole('button', { name: 'Approve' }).click();
    await page
      .getByRole('dialog')
      .getByLabel('Owner PIN')
      .fill(s.owner.pin ?? '');
    await expect(
      page.getByText('Approved. Finish on the new device.', { exact: true }),
    ).toBeVisible();
    await laptop.page.getByRole('button', { name: 'Make this phone your key' }).click({
      timeout: 15_000,
    });
    await laptop.page.getByLabel('Name of this phone').fill('Office laptop');
    await laptop.page.getByRole('button', { name: 'Continue' }).click();
    await expect(laptop.page).toHaveURL(/\/o\/today/);

    // Both are listed; rename the laptop.
    await page.goto(`http://${OWNER}/o/settings/security`);
    await expect(section.getByRole('listitem')).toHaveCount(2);
    await section.getByRole('button', { name: 'Rename Office laptop' }).click();
    const rename = page.getByRole('dialog');
    await rename.getByLabel('Name').fill('Old laptop');
    await rename.getByRole('button', { name: 'Save' }).click();
    await expect(row('Old laptop')).toBeVisible();
    await shot(page, 'owner-security-devices');
    await checkA11y(page);

    // Remove it: the fingerprint on the phone (the PIN from the approval still counts, 10 minutes).
    await section.getByRole('button', { name: 'Remove Old laptop' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(
      page.getByText('Removed. That device is signed out.', { exact: true }),
    ).toBeVisible();
    await expect(section.getByRole('listitem')).toHaveCount(1);
    await expect(section.getByRole('button', { name: 'Remove Front desk phone' })).toBeDisabled();

    // The laptop is signed out.
    await laptop.page.goto(`http://${OWNER}/o/today`);
    await expect(laptop.page).toHaveURL(/\/auth\/owner/);
    await laptop.context.close();
  });
});
