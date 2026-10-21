/**
 * Owner panel visual baselines and axe (PRD 14.5, 11.11, 12.11): Today, Needs action, Register, day
 * detail, Staff list and Staff profile at 390 px (owner-phone) and 1280 px (owner-desktop), each in
 * its main state plus loading (skeleton frozen), one error state, and the empty states the fixtures
 * have. Mock mode (`?mock=1`, fixtures from packages/contracts) with the client clock fixed at
 * 10:42 IST on 19 Oct 2026, so the data and the "updated" times never move.
 */
import type { Locator, Page } from '@playwright/test';
import { expect, test, VISUAL_NOW } from '../../fixtures';

const OWNER_PROJECTS = new Set(['owner-phone', 'owner-desktop']);

/** Fixture ids: Neha's day on 19 Oct (ownerDay.json) and Priya's profile (ownerStaffGet.json). */
const DAY_PATH = '/o/register/01K8EZTHPNQTWAVCVVCWXBXHMS/2026-10-19';
const PROFILE_PATH = '/o/staff/01K86AFQDXWDHQ8238N67SVDDK';

interface Screen {
  name: string;
  path: string;
  /** The endpoint behind the screen's main query, for the frozen loading and error states. */
  endpoint: string;
  /** Something only the loaded screen shows, checked before every main-state screenshot. */
  ready: (page: Page) => Locator;
}

const shown = (page: Page, text: string) =>
  page.locator('#owner-main').getByText(text, { exact: true }).filter({ visible: true }).first();

const SCREENS: Screen[] = [
  {
    name: 'today',
    path: '/o/today',
    endpoint: 'ownerToday',
    ready: (page) => page.getByTestId('today-headline'),
  },
  {
    name: 'actions',
    path: '/o/actions',
    endpoint: 'ownerActions',
    ready: (page) => shown(page, 'New phone for Bhumi'),
  },
  {
    name: 'register',
    path: '/o/register',
    endpoint: 'ownerRegister',
    ready: (page) => shown(page, 'Priya Solanki'),
  },
  {
    name: 'day',
    path: DAY_PATH,
    endpoint: 'ownerDay',
    ready: (page) => page.locator('#owner-main .owner-map .leaflet-container'),
  },
  {
    name: 'staff',
    path: '/o/staff',
    endpoint: 'ownerStaffList',
    ready: (page) => shown(page, 'Priya Solanki'),
  },
  {
    name: 'profile',
    path: PROFILE_PATH,
    endpoint: 'ownerStaffGet',
    ready: (page) => page.locator('#owner-main').getByRole('tablist'),
  },
  {
    name: 'roster',
    path: '/o/roster?week=2026-W43',
    endpoint: 'ownerRosterGet',
    ready: (page) => shown(page, 'Priya Solanki'),
  },
];

/**
 * Open an owner screen on the fixtures as the owner. Map tiles and the photo endpoints are cut off
 * (the data comes from the mock, and the tiles would make the frame depend on the network).
 */
async function openOwner(page: Page, path: string, variants: string[] = [], settle = true) {
  await page.clock.setFixedTime(VISUAL_NOW);
  await page.route('https://tile.openstreetmap.org/**', (route) => route.abort());
  await page.route(/\/api\/v1\/owner\/(staff\/[^/]+\/photo|punches\/[^/]+\/selfie)/, (route) =>
    route.abort(),
  );
  const variant = ['me:owner', ...variants].join(',');
  await page.goto(`${path}${path.includes('?') ? '&' : '?'}mock=1&variant=${variant}`);
  // The shell and its landmarks must be there: a crash page can never become a baseline.
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByTestId('owner-title')).toBeVisible();
  if (settle) await expect(page.locator('.fs-skeleton')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
}

/** No crash card and no React Router error page, right before a screenshot. */
async function noCrash(page: Page) {
  await expect(page.getByTestId('owner-route-error')).toHaveCount(0);
  await expect(page.getByText('Unexpected Application Error')).toHaveCount(0);
  await expect(page.getByRole('main')).toBeVisible();
}

test.describe('owner visual', () => {
  test.beforeEach(({ page: _page }, info) => {
    test.skip(!OWNER_PROJECTS.has(info.project.name), 'owner screens at 390 and 1280 only');
  });

  for (const s of SCREENS) {
    test(`OWN-V ${s.name}: main state matches its baseline, axe clean`, async ({
      page,
      checkA11y,
    }) => {
      await openOwner(page, s.path);
      await expect(s.ready(page)).toBeVisible();
      await noCrash(page);
      await expect(page).toHaveScreenshot(`owner-${s.name}.png`, { fullPage: true });
      await checkA11y();
    });

    test(`OWN-V ${s.name}: loading keeps the layout`, async ({ page }) => {
      await openOwner(page, s.path, [`${s.endpoint}:loading`], false);
      await expect(page.locator('#owner-main .fs-skeleton').first()).toBeVisible();
      await noCrash(page);
      await expect(page).toHaveScreenshot(`owner-${s.name}-loading.png`);
    });

    test(`OWN-V ${s.name}: error card in plain words with Try again`, async ({
      page,
      checkA11y,
    }) => {
      await openOwner(page, s.path, [`${s.endpoint}:error`]);
      await expect(page.getByTestId('owner-error')).toBeVisible();
      await noCrash(page);
      await expect(page).toHaveScreenshot(`owner-${s.name}-error.png`);
      await checkA11y();
    });
  }

  test('OWN-V register: the Month grid toggle keeps the table on a phone, axe clean', async ({
    page,
    checkA11y,
  }, info) => {
    test.skip(info.project.name !== 'owner-phone', 'the toggle is a phone control');
    await openOwner(page, '/o/register');
    await expect(shown(page, 'Priya Solanki')).toBeVisible();
    await page.locator('#owner-main').getByRole('radio', { name: 'Month grid' }).check();
    await expect(page.locator('#owner-main table')).toBeVisible();
    await noCrash(page);
    await expect(page).toHaveScreenshot('owner-register-month.png', { fullPage: true });
    await checkA11y();
  });

  test('OWN-V register: the key opens from its button, axe clean', async ({ page, checkA11y }) => {
    await openOwner(page, '/o/register');
    await expect(shown(page, 'Priya Solanki')).toBeVisible();
    await page.locator('#owner-main').getByRole('button', { name: 'Key' }).click();
    await expect(page.getByRole('dialog').getByText('At a venue')).toBeVisible();
    await noCrash(page);
    await expect(page).toHaveScreenshot('owner-register-key.png');
    await checkA11y();
  });

  test('OWN-V today: holiday says the salon is closed', async ({ page, checkA11y }) => {
    await openOwner(page, '/o/today', ['ownerToday:holiday']);
    await expect(shown(page, 'Salon closed today (Dussehra).')).toBeVisible();
    await noCrash(page);
    await expect(page).toHaveScreenshot('owner-today-holiday.png', { fullPage: true });
    await checkA11y();
  });

  test('OWN-V today: before the first shift', async ({ page }) => {
    await openOwner(page, '/o/today', ['ownerToday:before-first-shift']);
    await expect(page.getByTestId('owner-route-error')).toHaveCount(0);
    await expect(page.locator('#owner-main').getByText(/First shift starts at/)).toBeVisible();
    await noCrash(page);
    await expect(page).toHaveScreenshot('owner-today-early.png', { fullPage: true });
  });

  test('OWN-V actions: all clear', async ({ page, checkA11y }) => {
    await openOwner(page, '/o/actions', ['ownerActions:empty']);
    await expect(page.getByTestId('owner-empty')).toBeVisible();
    await noCrash(page);
    await expect(page).toHaveScreenshot('owner-actions-empty.png');
    await checkA11y();
  });

  test('OWN-V duty: off-site duty form, axe clean', async ({ page, checkA11y }) => {
    await openOwner(page, '/o/duties/new?date=2026-10-24');
    await expect(page.getByRole('button', { name: 'Save duty' })).toBeVisible();
    await expect(shown(page, 'Kajal')).toBeVisible();
    await noCrash(page);
    await expect(page).toHaveScreenshot('owner-duty.png', { fullPage: true });
    await checkA11y();
  });

  test('OWN-V door: the phone shows the door code with its countdown', async ({
    page,
    checkA11y,
  }) => {
    await openOwner(page, '/o/door-code');
    await expect(page.getByTestId('door-qr')).toBeVisible();
    await expect(page.getByTestId('door-countdown')).toHaveText('New code in 30 s');
    await noCrash(page);
    await expect(page).toHaveScreenshot('owner-door.png');
    await checkA11y();
  });

  test('OWN-V door: offline says the code needs the internet', async ({ page, context }) => {
    await openOwner(page, '/o/door-code');
    await expect(page.getByTestId('door-qr')).toBeVisible();
    await context.setOffline(true);
    await expect(page.getByText('The door code needs the internet on this phone.')).toBeVisible();
    await noCrash(page);
    await expect(page).toHaveScreenshot('owner-door-offline.png');
  });

  test('OWN-V more: grouped list with one-line hints, axe clean', async ({ page, checkA11y }) => {
    await openOwner(page, '/o/more');
    await expect(shown(page, 'Month-end salaries and payslips')).toBeVisible();
    await noCrash(page);
    await expect(page).toHaveScreenshot('owner-more.png', { fullPage: true });
    await checkA11y();
  });
});

/** The public payslip check (`/v/:token`): outside every shell, no sign-in. */
async function openVerify(page: Page, token: string, variants: string[] = []) {
  await page.clock.setFixedTime(VISUAL_NOW);
  const variant = variants.length > 0 ? `&variant=${variants.join(',')}` : '';
  await page.goto(`/v/${token}?mock=1${variant}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Payslip check' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

test.describe('payslip verify page', () => {
  test.beforeEach(({ page: _page }, info) => {
    test.skip(!OWNER_PROJECTS.has(info.project.name), 'public page at 390 and 1280');
  });

  test('OWN-V verify: a valid payslip shows only the allowed fields (O-14.3)', async ({
    page,
    checkA11y,
  }) => {
    await openVerify(page, 'VFY01K8PRIYAOCT2026R1');
    await expect(page.getByTestId('verify-result')).toBeVisible();
    await expect(page.getByText('Priya S.')).toBeVisible();
    await expect(page).toHaveScreenshot('owner-verify.png');
    await checkA11y();
  });

  test('OWN-V verify: a malformed link is not valid', async ({ page, checkA11y }) => {
    await openVerify(page, 'nope');
    await expect(page.getByTestId('verify-invalid')).toBeVisible();
    await expect(page).toHaveScreenshot('owner-verify-invalid.png');
    await checkA11y();
  });

  test('OWN-V verify: loading keeps the layout', async ({ page }) => {
    await openVerify(page, 'VFY01K8PRIYAOCT2026R1', ['verifyPayslip:loading']);
    await expect(page.locator('.fs-skeleton').first()).toBeVisible();
    await expect(page).toHaveScreenshot('owner-verify-loading.png');
  });
});
