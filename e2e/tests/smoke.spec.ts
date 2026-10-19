/** Platform smoke (WP-1): the built Worker serves assets and API, headers are set, test routes work. */
import { expect, test } from '../fixtures';

test.describe('platform smoke', () => {
  test('X-01.2 API never returns index.html and SPA routes do', async ({ request }) => {
    const api = await request.get('/api/v1/does-not-exist');
    expect(api.status()).toBe(404);
    expect(api.headers()['content-type']).toContain('application/json');
    const spa = await request.get('/some/spa/route');
    expect(spa.status()).toBe(200);
    expect(await spa.text()).toContain('<div id="root">');
  });

  test('X-03.1 security headers on API responses', async ({ request }) => {
    const res = await request.get('/api/v1/health');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers()['permissions-policy']).toContain('geolocation=(self)');
    expect(res.headers()['x-robots-tag']).toBe('noindex, nofollow');
  });

  test('reset seeds the basic salon', async ({ reset }) => {
    const s = await reset('basic-salon');
    expect(s.owner.email).toBe('owner@feelings.test');
  });

  test('signed-out staff land on sign-in', async ({ page, reset, checkA11y }) => {
    await reset('basic-salon');
    await page.goto('/');
    await expect(page).toHaveURL(/\/signin/);
    await expect(page.locator('h1')).toBeVisible();
    await checkA11y();
  });

  test('door QR URLs never punch', async ({ request }) => {
    const res = await request.get('/q/site/ABCDEFGHJK');
    expect(await res.text()).toContain('Open Feelings and tap Scan door code.');
  });
});
