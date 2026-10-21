/**
 * Owner settings (PRD 4.17, 10.7, 14.5, O-16, O-18): the section list, rule sections with their
 * "what this does" lines, Salon, Location and door with calibration, Shifts, Holidays, Security and
 * the Audit log at 390 and 1280, with axe. Mock mode, client clock 10:42 IST on 19 Oct 2026.
 */
import { expect, test } from '../../fixtures';
import { noCrash, OWNER_PROJECTS, openOwner, shown } from './helpers';

const PAGES = [
  { name: 'settings', path: '/o/settings', ready: 'Attendance rules' },
  { name: 'settings-attendance', path: '/o/settings/attendance', ready: 'Grace' },
  { name: 'settings-pay', path: '/o/settings/pay', ready: 'Overtime pay' },
  { name: 'settings-salon', path: '/o/settings/salon', ready: 'Salon name' },
  { name: 'settings-location', path: '/o/settings/location', ready: 'Calibrate at the counter' },
  { name: 'settings-shifts', path: '/o/settings/shifts', ready: 'Full day' },
  { name: 'settings-holidays', path: '/o/settings/holidays', ready: 'No-leave days' },
  { name: 'settings-security', path: '/o/settings/security', ready: 'Owner PIN' },
  { name: 'settings-audit', path: '/o/settings/audit', ready: 'Everything' },
  { name: 'setup', path: '/o/setup', ready: 'Selfie on check-in' },
  { name: 'setup-location', path: '/o/setup?step=location', ready: 'Calibrate at the counter' },
] as const;

test.describe('owner settings visual', () => {
  test.beforeEach(({ page: _page }, info) => {
    test.skip(!OWNER_PROJECTS.has(info.project.name), 'owner screens at 390 and 1280 only');
  });

  for (const p of PAGES) {
    test(`OWN-S ${p.name}: matches its baseline, axe clean (O-16)`, async ({ page, checkA11y }) => {
      await openOwner(page, p.path);
      await expect(shown(page, p.ready)).toBeVisible();
      await noCrash(page);
      await expect(page).toHaveScreenshot(`owner-${p.name}.png`, { fullPage: true });
      await checkA11y();
    });
  }

  test('OWN-S settings: a change shows its new meaning before saving (O-16.1)', async ({
    page,
  }) => {
    await openOwner(page, '/o/settings/attendance');
    await expect(
      page.getByText("Grace: 10 min. Late arrivals within 10 min aren't counted."),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Increase' }).first().click();
    await expect(
      page.getByText("Grace: 11 min. Late arrivals within 11 min aren't counted."),
    ).toBeVisible();
  });
});
