/**
 * "Use a recovery code" on the owner host (docs/owner-access.md "Passkeys" flow 5, slice 7 part B).
 * Runs only in the `split-hosts` project. A real code needs an admin with database access, so the
 * redeem and enrol steps are covered by the Workers tests (owner-recovery.test.ts); this spec walks the
 * screen from the sign-in page and checks that a wrong code gets the one plain refusal. A screenshot
 * is attached to the report.
 */
import { expect, test } from '../../fixtures';
import { OWNER, shot } from './owner-kit';

test.describe('SPLIT-6 owner recovery code', () => {
  test('SPLIT-6.1 the sign-in page leads to the code screen; a wrong code is refused plainly', async ({
    page,
    reset,
    checkA11y,
  }) => {
    await reset('basic-salon');
    await page.goto(`http://${OWNER}/auth/owner`);
    await page.getByRole('button', { name: 'Lost your phone?' }).click();
    await page.getByRole('button', { name: 'Use a recovery code' }).click();
    await expect(page).toHaveURL(/\/auth\/owner\/recovery/);
    await expect(page.getByRole('heading', { name: 'Use a recovery code' })).toBeVisible();

    const field = page.getByLabel('Recovery code');
    // Typed any way, it is shown as capitals in groups of four.
    await field.fill('abcd efgh jkmn pqrs');
    await expect(field).toHaveValue('ABCD-EFGH-JKMN-PQRS');
    await checkA11y(page);
    await shot(page, 'owner-recovery-code');

    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(
      page.getByText('That code did not work. Check it, or ask for a new one.'),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/auth\/owner\/recovery/);

    // Too short: asked to check before anything is sent.
    await field.fill('ABCD');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText('A recovery code has 16 letters and numbers.')).toBeVisible();

    await page.getByRole('button', { name: 'Back to sign-in' }).click();
    await expect(page).toHaveURL(/\/auth\/owner$/);
  });
});
