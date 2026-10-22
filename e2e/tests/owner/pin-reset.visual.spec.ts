/**
 * Forgotten owner PIN (docs/owner-access.md, Passkeys flow 6): Security while the server's reset
 * window is open (`ownerSecurityGet:pin-reset`), at 390 and 1280, with axe. Mock mode, client clock
 * 10:42 IST on 19 Oct 2026; the window in the fixture ends at 10:55.
 */
import { expect, test } from '../../fixtures';
import { noCrash, OWNER_PROJECTS, openOwner, shown } from './helpers';

test.describe('owner forgotten PIN visual', () => {
  test.beforeEach(({ page: _page }, info) => {
    test.skip(!OWNER_PROJECTS.has(info.project.name), 'owner screens at 390 and 1280 only');
  });

  test('OWN-S settings-security-pin-reset: new PIN without the old one, axe clean', async ({
    page,
    checkA11y,
  }) => {
    await openOwner(page, '/o/settings/security', ['ownerSecurityGet:pin-reset']);
    await expect(shown(page, 'Set new PIN')).toBeVisible();
    await expect(page.getByText('until 10:55')).toBeVisible();
    await expect(page.getByLabel('Current PIN')).toHaveCount(0);
    await noCrash(page);
    await expect(page).toHaveScreenshot('owner-settings-security-pin-reset.png', {
      fullPage: true,
    });
    await checkA11y();
  });

  test('OWN-S settings-security: "Forgot your PIN?" explains the email sign-in first', async ({
    page,
  }) => {
    await openOwner(page, '/o/settings/security');
    await page.getByRole('button', { name: 'Forgot your PIN?' }).click();
    const sheet = page.getByRole('dialog', { name: 'Forgot your PIN?' });
    await expect(sheet.getByText('the password does not count')).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Sign in with an email code' })).toBeVisible();
  });
});
