/**
 * Unknown client routes (custom 404 screen), under a known prefix: the Worker serves the shell there (anything else is the Worker's own 404 page). Mock mode gives a signed-in person (staff on the staff
 * projects, owner on the owner projects); the real, signed-out run checks the Sign in way back.
 * Baselines: `gh workflow run snapshots -f ref=<branch> -f grep=NOTFOUND`.
 */
import { expect, test, VISUAL_NOW } from '../../fixtures';

test.describe('not found screen', () => {
  test('NOTFOUND-1 staff: warm page and a way back to Today', async ({ page, checkA11y }, info) => {
    test.skip(!info.project.name.startsWith('staff-'), 'staff projects');
    await page.clock.setFixedTime(VISUAL_NOW);
    await page.goto('/me/no-such-page?mock=1&allowBrowser=1');
    await expect(
      page.getByRole('heading', { level: 1, name: /That page isn't here/ }),
    ).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    if (info.project.name === 'staff-android')
      await expect(page).toHaveScreenshot('staff-not-found.png');
    await checkA11y();
    await page.getByTestId('not-found-home').click();
    await expect(page).toHaveURL(/localhost:8787\/$/);
    await expect(page.getByRole('heading', { level: 1, name: /Good morning/ })).toBeVisible();
  });

  test('NOTFOUND-2 owner: the way back is owner Today', async ({ page, checkA11y }, info) => {
    test.skip(!info.project.name.startsWith('owner-'), 'owner projects');
    await page.clock.setFixedTime(VISUAL_NOW);
    await page.goto('/o/no-such-page?mock=1&variant=me:owner');
    await expect(
      page.getByRole('heading', { level: 1, name: /That page isn't here/ }),
    ).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot('owner-not-found.png');
    await checkA11y();
    await page.getByTestId('not-found-home').click();
    await expect(page).toHaveURL(/\/o\/today/);
  });

  test('NOTFOUND-3 signed out: the way back is Sign in', async ({ page, reset }, info) => {
    test.skip(info.project.name !== 'staff-android', 'one run is enough');
    await reset('basic-salon');
    await page.goto('/me/no-such-page');
    await expect(
      page.getByRole('heading', { level: 1, name: /That page isn't here/ }),
    ).toBeVisible();
    await page.getByTestId('not-found-home').click();
    await expect(page).toHaveURL(/\/signin/);
  });
});
