/** X-02.9: a lazy chunk that no longer exists must not end on "Unexpected Application Error". */
import { expect, test } from '../../fixtures';

test.describe('stale chunk recovery', () => {
  test.use({ serviceWorkers: 'block' });

  test('X-02.9 missing asset is a 404 and SPA navigations still get the shell', async ({
    request,
  }) => {
    const missing = await request.get('/assets/missing-abc.js');
    expect(missing.status()).toBe(404);
    const shell = await request.get('/o/today');
    expect(shell.status()).toBe(200);
    expect(await shell.text()).toContain('<div id="root">');
  });

  test('X-02.9 a blocked lazy chunk recovers with one reload and no error page', async ({
    page,
    reset,
  }) => {
    await reset('basic-salon');
    let blocked = 0;
    let navigations = 0;
    // `load` fires for real page loads only (not for in-app route changes).
    page.on('load', () => {
      navigations += 1;
    });
    // Block the sign-in screen's lazy chunk for the first request only: the "deleted file" case.
    await page.route(/\/assets\/sign-in[^/]*\.js$/i, (route) => {
      blocked += 1;
      return blocked === 1 ? route.abort() : route.continue();
    });
    await page.goto('/signin');
    await expect(page.getByText('Unexpected Application Error')).toHaveCount(0);
    await expect(page.getByTestId('route-error')).toHaveCount(0);
    await expect(page.locator('#root > *').first()).toBeVisible();
    expect(blocked).toBeGreaterThanOrEqual(2);
    expect(navigations).toBeLessThanOrEqual(2);
  });
});
