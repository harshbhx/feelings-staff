/**
 * Staff screens (PRD 5.1, 14.5; AC S-03, S-10, S-11, S-12, S-13): visual baselines at 390 px on
 * staff-android, layout checks on staff-ios, axe on both. Mock mode (`?mock=1`, fixtures from
 * packages/contracts) with `allowBrowser=1`, the client clock fixed at 10:42 IST on 19 Oct 2026.
 *
 * Baselines: `gh workflow run snapshots -f ref=<branch> -f grep=STAFF-VIS`.
 */
import type { Locator, Page, TestInfo } from '@playwright/test';
import { expect, test, VISUAL_NOW } from '../../fixtures';

interface Screen {
  name: string;
  path: string;
  /** `endpoint:variant` for the mock client; a variant with no fixture (`error`) answers 501. */
  variant?: string;
  /** Visible once the screen has its data (or its error card). */
  ready: (page: Page) => Locator;
  /**
   * Visible once a later query has landed too. Today's presence query answers after the day, so
   * "Step out" joins the action bar a moment after "Check out"; without this the shot raced it.
   */
  settled?: (page: Page) => Locator;
}

const h1 = (name: string | RegExp) => (page: Page) => page.getByRole('heading', { level: 1, name });
const alert = (text: string) => (page: Page) => page.getByRole('alert').filter({ hasText: text });

const SCREENS: Screen[] = [
  {
    name: 'today',
    path: '/',
    ready: h1(/Good morning, Priya/),
    settled: (page) => page.locator('.staff-actionbar').getByRole('button', { name: 'Step out' }),
  },
  { name: 'today-ready', path: '/', variant: 'meToday:ready', ready: h1(/Good morning/) },
  {
    name: 'today-checked-out',
    path: '/',
    variant: 'meToday:checked-out',
    ready: h1(/Good morning/),
  },
  { name: 'today-on-break', path: '/', variant: 'meToday:on-break', ready: h1(/Good morning/) },
  { name: 'today-week-off', path: '/', variant: 'meToday:week-off', ready: h1(/Good morning/) },
  { name: 'today-on-leave', path: '/', variant: 'meToday:on-leave', ready: h1(/Good morning/) },
  {
    name: 'today-pending-proof',
    path: '/',
    variant: 'meToday:pending-proof',
    ready: h1(/Good morning/),
  },
  {
    name: 'today-error',
    path: '/',
    variant: 'meToday:error',
    ready: alert("We couldn't load today."),
  },
  { name: 'month', path: '/month', ready: h1('Your month') },
  {
    name: 'month-error',
    path: '/month',
    variant: 'meDays:error',
    ready: alert("We couldn't load this month."),
  },
  { name: 'day', path: '/day/2026-10-15', ready: h1(/15 Oct/) },
  { name: 'requests-leave', path: '/requests', ready: h1('Requests') },
  { name: 'requests-fixes', path: '/requests?tab=fixes', ready: h1('Requests') },
  { name: 'leave-form', path: '/requests/leave', ready: h1('Ask for leave') },
  { name: 'fix-form', path: '/requests/fix?date=2026-10-19', ready: h1('Fix a day') },
  { name: 'payslips', path: '/payslips', ready: h1('Payslips') },
  {
    name: 'payslips-empty',
    path: '/payslips',
    variant: 'mePayslips:empty',
    ready: h1('Payslips'),
  },
  { name: 'payslip', path: '/payslips/01K885FABFFQJST6Z99BWHFJAK', ready: h1('October 2026') },
  { name: 'me', path: '/me', ready: h1('Me') },
  { name: 'me-data', path: '/me/data', ready: h1('My data') },
  { name: 'me-privacy', path: '/me/privacy', ready: h1('Privacy notice') },
  { name: 'scan', path: '/scan', ready: h1('Scan door code') },
  { name: 'fixit-location', path: '/fix/location', ready: h1(/^Location is off for this app/) },
  {
    name: 'fixit-precise',
    path: '/fix/precise',
    ready: h1(/^Your phone is sharing only an approximate location/),
  },
  { name: 'fixit-camera', path: '/fix/camera', ready: h1(/^Camera is off for this app/) },
  { name: 'fixit-notifications', path: '/fix/notifications', ready: h1(/^Notifications are off/) },
];

/** Check-in sheet states (PRD 4.3.2-4.3.6), frozen with `?sheet=<state>` in mock mode. */
const SHEETS = [
  'confirm-too-early',
  'locating',
  'camera',
  'pin',
  'pin-wrong',
  'success-in',
  'success-out',
  'needs-proof',
  'venue',
  'sent',
  'queued',
  'denied',
  'approximate',
  'outside',
  'pin-locked',
  'device-pending',
] as const;

const A11Y_SHEETS = new Set(['locating', 'pin', 'success-in', 'needs-proof', 'denied']);

function url(path: string, extra: Record<string, string> = {}): string {
  const [base, query = ''] = path.split('?');
  const q = new URLSearchParams(query);
  q.set('mock', '1');
  q.set('allowBrowser', '1');
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  return `${base}?${q}`;
}

function baselineOnly(info: TestInfo): void {
  test.skip(
    info.project.name !== 'staff-android',
    'staff baselines are taken at 390 px on Android',
  );
}

function staffOnly(info: TestInfo): void {
  test.skip(!info.project.name.startsWith('staff-'), 'staff screens run on the staff projects');
}

/** Real install prompts are ignored so the gate is the same on every run; synthetic ones pass. */
async function freeze(page: Page): Promise<void> {
  await page.clock.setFixedTime(VISUAL_NOW);
  await page.addInitScript(() => {
    window.addEventListener(
      'beforeinstallprompt',
      (e) => {
        if (e.isTrusted) e.stopImmediatePropagation();
      },
      true,
    );
  });
}

async function settle(page: Page): Promise<void> {
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
}

async function openScreen(page: Page, s: Screen): Promise<void> {
  await freeze(page);
  await page.goto(url(s.path, s.variant ? { variant: s.variant } : {}));
  await expect(s.ready(page).first()).toBeVisible();
  if (s.settled) await expect(s.settled(page)).toBeVisible();
  await settle(page);
}

test.describe('staff screens', () => {
  for (const s of SCREENS) {
    test(`STAFF-VIS ${s.name} matches its baseline and passes axe`, async ({
      page,
      checkA11y,
    }, info) => {
      staffOnly(info);
      await openScreen(page, s);
      if (info.project.name === 'staff-android') {
        // The scanner shows the live (fake) camera feed; only the frame around it is compared.
        // The version line on Me changes with every build.
        // The notification state on Me resolves after the first paint; wait for it.
        if (s.name === 'me') await expect(page.getByText('Notifications are off')).toBeVisible();
        await expect(page).toHaveScreenshot(`staff-${s.name}.png`, {
          mask: [page.locator('video'), page.getByTestId('app-version')],
        });
      }
      await checkA11y();
    });
  }

  test('STAFF-LAYOUT every screen fits 390 px with no sideways scroll and 44 px targets', async ({
    page,
  }, info) => {
    staffOnly(info);
    for (const s of SCREENS) {
      await openScreen(page, s);
      const problems = await page.evaluate(() => {
        const out: string[] = [];
        if (document.documentElement.scrollWidth > window.innerWidth + 1)
          out.push(`scrolls sideways (${document.documentElement.scrollWidth} px)`);
        // Same rules as the kit (KIT-04): chips, inputs and radio rows count their drawn wrapper, small
        // buttons extend their target 2 px above and below, links inside running text are exempt.
        const sel =
          'button:not([disabled]), a[href]:not(p a), input:not([type="hidden"]), [role="tab"], [role="radio"]';
        for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
          const target =
            el.closest(
              '.fs-chip, .fs-input-wrap, .fs-pinpad__display, .fs-choice, .fs-switch-row',
            ) ?? (el as Element);
          const r = target.getBoundingClientRect();
          if (r.width <= 1 || r.height <= 1) continue; // hidden or visually hidden
          const extra = el.matches('.fs-btn[data-size="sm"]') ? 4 : 0;
          if (r.height + extra < 43.5 || r.width < 43.5) {
            const label = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim();
            out.push(
              `${el.tagName.toLowerCase()} "${label.slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`,
            );
          }
        }
        return out;
      });
      expect(problems, s.name).toEqual([]);
    }
  });
});

test.describe('check-in sheet', () => {
  for (const name of SHEETS) {
    test(`STAFF-VIS sheet ${name} matches its baseline`, async ({ page, checkA11y }, info) => {
      baselineOnly(info);
      await freeze(page);
      await page.goto(url('/', { sheet: name }));
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.locator('[data-punch-step]')).toBeVisible();
      await settle(page);
      await expect(page).toHaveScreenshot(`staff-sheet-${name}.png`, {
        mask: [page.locator('video')],
      });
      if (A11Y_SHEETS.has(name)) await checkA11y();
    });
  }
});

const UA = {
  iosSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  iosChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1',
  androidWhatsApp:
    'Mozilla/5.0 (Linux; Android 14; Redmi Note 12; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36 WhatsApp/2.24.21.80',
  desktop:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
};

async function openGate(page: Page): Promise<void> {
  await freeze(page);
  await page.goto('/?mock=1');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Add Feelings to your home screen' }),
  ).toBeVisible();
  await settle(page);
}

test.describe('install gate', () => {
  test('S-03.1 S-03.3 Android shows the install button only after beforeinstallprompt', async ({
    page,
    checkA11y,
  }, info) => {
    baselineOnly(info);
    await openGate(page);
    const install = page.getByRole('button', { name: 'Install the app' });
    await expect(install).toHaveCount(0);
    await expect(page).toHaveScreenshot('staff-install-android.png');
    await checkA11y();
    await page.evaluate(() => {
      const e = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
        prompt: async () => {},
        userChoice: Promise.resolve({ outcome: 'dismissed', platform: 'web' }),
      });
      window.dispatchEvent(e);
    });
    await expect(install).toBeVisible();
    await expect(page).toHaveScreenshot('staff-install-android-prompt.png');
  });

  test.describe('iPhone Safari', () => {
    test.use({ userAgent: UA.iosSafari });
    test('S-03.2 iOS Safari shows the 3-step sheet', async ({ page, checkA11y }, info) => {
      baselineOnly(info);
      await openGate(page);
      await expect(page.getByText('Three steps in Safari')).toBeVisible();
      await expect(page).toHaveScreenshot('staff-install-ios.png');
      await checkA11y();
    });
  });

  test.describe('another iPhone browser', () => {
    test.use({ userAgent: UA.iosChrome });
    test('S-03.2 other iOS browsers say open in Safari', async ({ page }, info) => {
      baselineOnly(info);
      await openGate(page);
      await expect(page.getByText('Open this link in Safari to install the app.')).toBeVisible();
      await expect(page).toHaveScreenshot('staff-install-ios-other.png');
    });
  });

  test.describe('Android in-app browser', () => {
    test.use({ userAgent: UA.androidWhatsApp });
    test('S-03.3 an in-app browser says open in Chrome', async ({ page }, info) => {
      baselineOnly(info);
      await openGate(page);
      await expect(page.getByText('Open this link in Chrome to install the app.')).toBeVisible();
      await expect(page).toHaveScreenshot('staff-install-android-inapp.png');
    });
  });

  test.describe('desktop', () => {
    test.use({
      userAgent: UA.desktop,
      viewport: { width: 1280, height: 800 },
      isMobile: false,
      hasTouch: false,
    });
    test('S-03.3 a computer shows "Open this link on your phone" with a QR', async ({
      page,
      checkA11y,
    }, info) => {
      baselineOnly(info);
      await openGate(page);
      await expect(page.getByText('Open this link on your phone.')).toBeVisible();
      await expect(page).toHaveScreenshot('staff-install-desktop.png');
      await checkA11y();
    });
  });

  test('S-03.4 the installed app never shows install UI', async ({ page }, info) => {
    staffOnly(info);
    await freeze(page);
    await page.addInitScript(() => {
      const real = window.matchMedia.bind(window);
      window.matchMedia = (q: string) => {
        const list = real(q);
        if (!q.includes('display-mode: standalone')) return list;
        return new Proxy(list, {
          get(target, prop) {
            if (prop === 'matches') return true;
            const v: unknown = Reflect.get(target, prop, target);
            return typeof v === 'function' ? v.bind(target) : v;
          },
        });
      };
    });
    await page.goto('/?mock=1');
    await expect(
      page.getByRole('heading', { level: 1, name: /Good morning, Priya/ }),
    ).toBeVisible();
    await expect(page.getByText('Add Feelings to your home screen')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Install the app' })).toHaveCount(0);
  });
});
