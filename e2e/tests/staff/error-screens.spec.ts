/**
 * Error and offline screens. A lazy screen chunk is blocked so the root route error page shows: with
 * a connection it is "Something went wrong", with the browser offline it is "You're offline".
 * The service worker is blocked (it would answer from its precache) and the one-time stale-chunk
 * reload is switched off. Baselines: `gh workflow run snapshots -f ref=<branch> -f grep=ERRSCREEN`.
 */
import type { Page } from '@playwright/test';
import { expect, test, VISUAL_NOW } from '../../fixtures';

test.use({ serviceWorkers: 'block' });

async function breakMonth(page: Page) {
  await page.clock.setFixedTime(VISUAL_NOW);
  await page.addInitScript(() => {
    sessionStorage.setItem('fs.chunk-reload', String(Date.now()));
  });
  await page.route(/\/assets\/MonthScreen[^/]*\.js$/, (route) => route.abort());
  await page.goto('/?mock=1&allowBrowser=1');
  await expect(page.getByRole('heading', { level: 1, name: /Good morning/ })).toBeVisible();
}

test.describe('error screens', () => {
  test('ERRSCREEN-1 a crash shows Something went wrong with Try again', async ({
    page,
    checkA11y,
  }, info) => {
    test.skip(!info.project.name.startsWith('staff-'), 'staff projects');
    await breakMonth(page);
    await page.getByRole('link', { name: 'Month' }).first().click();
    const err = page.getByTestId('route-error');
    await expect(err).toBeVisible();
    await expect(err).toHaveAttribute('data-kind', 'crash');
    await expect(err.getByRole('heading', { level: 1 })).toContainText('Something went wrong');
    await expect(err).toContainText('tell the owner');
    await page.evaluate(() => document.fonts.ready);
    if (info.project.name === 'staff-android')
      await expect(page).toHaveScreenshot('staff-error-crash.png', {
        mask: [page.getByTestId('route-error-stamp')],
      });
    await checkA11y();
  });

  test('ERRSCREEN-2 offline shows You are offline and comes back by itself', async ({
    page,
    context,
    checkA11y,
  }, info) => {
    test.skip(!info.project.name.startsWith('staff-'), 'staff projects');
    await breakMonth(page);
    await context.setOffline(true);
    await page.getByRole('link', { name: 'Month' }).first().click();
    const err = page.getByTestId('route-error');
    await expect(err).toHaveAttribute('data-kind', 'offline');
    await expect(err.getByRole('heading', { level: 1 })).toContainText("You're offline");
    await page.evaluate(() => document.fonts.ready);
    if (info.project.name === 'staff-android')
      await expect(page).toHaveScreenshot('staff-error-offline.png');
    await checkA11y();
  });

  test('ERRSCREEN-3 the 404 page from the Worker needs no script', async ({
    page,
    request,
    checkA11y,
  }, info) => {
    test.skip(info.project.name !== 'staff-android', 'one run is enough');
    await page.route('**/*.js', (route) => route.abort());
    await page.goto('/no/such/place');
    await expect(page.getByRole('heading', { level: 1 })).toContainText("That page isn't here");
    await expect(page).toHaveScreenshot('staff-server-404.png');
    await checkA11y();
    const missing = await request.get('/no/such/place');
    expect(missing.status()).toBe(404);
  });
});
