/**
 * Split build, two hosts (docs/owner-access.md, ADR-19, slice 1b). Runs only with `E2E_SPLIT=1`, against
 * the preview Worker started with OWNER_HOST=owner.example.test:8787 (the e2e workflow does that
 * in its own step). Both hosts are placeholders. API-level checks send a Host header to localhost; the
 * browser checks reach the hosts through Chromium's host resolver rule in playwright.config.ts.
 */
import { type APIRequestContext, expect, test } from '@playwright/test';

const STAFF = 'staff.example.test:8787';
const OWNER = 'owner.example.test:8787';

const get = (request: APIRequestContext, host: string, path: string) =>
  request.get(path, { headers: { Host: host }, maxRedirects: 0 });

/** The module script and stylesheet URLs a page's HTML references. */
function assetsOf(html: string): string[] {
  return [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1] as string);
}

test.describe('SPLIT-1 the staff host serves no owner shell', () => {
  test('SPLIT-1.1 owner pages and owner API answer 404 on the staff host', async ({ request }) => {
    for (const path of ['/o', '/o/today', '/auth/owner', '/api/v1/owner/today']) {
      const res = await get(request, STAFF, path);
      expect(res.status(), path).toBe(404);
    }
  });

  test('SPLIT-1.2 the staff shell loads and references only staff files', async ({ request }) => {
    const res = await get(request, STAFF, '/');
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain('<title>Feelings Staff</title>');
    const files = assetsOf(html);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const asset = await get(request, STAFF, file);
      expect(asset.status(), file).toBe(200);
      if (file.endsWith('.js')) {
        const code = await asset.text();
        expect(code).not.toContain('OwnerShell');
        expect(code).not.toContain('auth/owner');
      }
    }
  });

  test('SPLIT-1.3 the build folders are not reachable under their own names', async ({
    request,
  }) => {
    for (const host of [STAFF, OWNER]) {
      for (const path of ['/_s/index.html', '/_o/index.html', '/_o/.vite/manifest.json']) {
        const res = await get(request, host, path);
        expect(res.status(), `${host}${path}`).toBe(404);
      }
    }
  });

  test('SPLIT-1.4 staff manifest and service worker have no owner entry', async ({ request }) => {
    const manifest = await get(request, STAFF, '/manifest.webmanifest');
    expect(manifest.status()).toBe(200);
    const text = await manifest.text();
    expect(text).not.toContain('/o/');
    expect(JSON.parse(text)).toMatchObject({ name: 'Feelings Staff', scope: '/' });
    const sw = await get(request, STAFF, '/sw.js');
    expect(sw.status()).toBe(200);
    expect(await sw.text()).not.toContain('/o/today');
  });

  test('SPLIT-1.5 an owner file is a 404 on the staff host (and a staff file on the owner host)', async ({
    request,
  }) => {
    const staffHtml = await (await get(request, STAFF, '/')).text();
    const ownerHtml = await (await get(request, OWNER, '/o/today')).text();
    const entry = (html: string) => assetsOf(html).find((f) => f.endsWith('.js')) as string;
    expect(entry(ownerHtml)).not.toBe(entry(staffHtml));
    expect((await get(request, STAFF, entry(ownerHtml))).status()).toBe(404);
    expect((await get(request, OWNER, entry(staffHtml))).status()).toBe(404);
  });

  test('SPLIT-1.6 the staff page in a browser has no owner sign-in link and no owner routes', async ({
    page,
  }) => {
    const res = await page.goto(`http://${STAFF}/signin`);
    expect(res?.status()).toBe(200);
    await expect(page.getByRole('heading').first()).toBeVisible();
    await expect(page.getByRole('link', { name: /owner/i })).toHaveCount(0);
    const owner = await page.goto(`http://${STAFF}/o/today`);
    expect(owner?.status()).toBe(404);
  });
});

test.describe('SPLIT-2 the owner host serves the owner shell only', () => {
  test('SPLIT-2.1 owner page, own manifest and no staff pages', async ({ request }) => {
    const page = await get(request, OWNER, '/o/today');
    expect(page.status()).toBe(200);
    expect(await page.text()).toContain('<title>Feelings Owner</title>');
    const manifest = await get(request, OWNER, '/manifest.webmanifest');
    expect(manifest.status()).toBe(200);
    expect(await manifest.json()).toMatchObject({
      name: 'Feelings Owner',
      scope: '/',
      start_url: '/o/today?source=pwa',
    });
    for (const path of ['/signin', '/join/ABC', '/inbox', '/api/v1/auth/staff/login']) {
      const res = await get(request, OWNER, path);
      expect(res.status(), path).toBe(404);
    }
  });

  test('SPLIT-2.2 the owner app boots on its host and asks for sign-in', async ({ page }) => {
    await page.goto(`http://${OWNER}/o/today`);
    await page.waitForURL(/\/auth\/owner/);
    await expect(page.getByRole('heading').first()).toBeVisible();
  });
});
