/**
 * OWN-DEMO: the demo data buttons exist only on a preview. Mock mode: the public config says
 * `production` by default (the entry is not offered, and the page itself says it is not here) and
 * `preview` with the config:preview variant (entry, both buttons, and Reset asks first). The
 * server side of the gate (404 outside previews) is tested in app/worker/test/demo-data.test.ts.
 */
import { expect, test } from '../../fixtures';
import { OWNER_PROJECTS, openOwner } from './helpers';

test.describe('owner demo data entry', () => {
  test.beforeEach(({ page: _page }, info) => {
    test.skip(!OWNER_PROJECTS.has(info.project.name), 'owner screens at 390 and 1280 only');
  });

  test('OWN-DEMO-1: not offered and not reachable when the server is not a preview', async ({
    page,
  }) => {
    await openOwner(page, '/o/settings');
    await expect(page.getByText('Attendance rules').first()).toBeVisible();
    await expect(page.getByText('Demo data')).toHaveCount(0);
    await expect(page.getByText('Preview tools')).toHaveCount(0);
    await openOwner(page, '/o/settings/demo');
    await expect(page.getByText('Demo data tools are only on previews.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Load demo data' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Reset demo data' })).toHaveCount(0);
  });

  test('OWN-DEMO-2: on a preview the entry opens both buttons, and Reset asks first', async ({
    page,
  }) => {
    await openOwner(page, '/o/settings', ['config:preview']);
    await expect(page.getByText('Preview tools')).toBeVisible();
    await page.getByRole('link', { name: /Demo data/ }).click();
    await expect(page.getByRole('button', { name: 'Load demo data' })).toBeVisible();
    await page.getByRole('button', { name: 'Reset demo data' }).click();
    await expect(page.getByText('Reset the demo data?')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('Reset the demo data?')).toHaveCount(0);
  });
});
