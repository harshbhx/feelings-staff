/**
 * iPhone review shots (see playwright.shots.config.ts). Each screen opens in mock mode with the
 * client clock fixed at 10:42 IST on 19 Oct 2026 (the visual baselines' time), waits for its data,
 * then saves `shots-out/<project>/<name>.png` (the screen as the phone shows it) and, for long
 * screens, `<name>--full.png`. A screen that never gets ready is still captured, so the sheet shows
 * what went wrong instead of a gap.
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';

const VISUAL_NOW = Date.parse('2026-10-19T10:42:00+05:30');
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'shots-out');

interface Shot {
  name: string;
  path: string;
  /** Text or heading that shows the screen has its data. */
  ready?: string | RegExp;
  /** Also save the whole scrolling page. */
  full?: boolean;
  /** Staff screens run in a browser tab for the shots (`allowBrowser=1`). */
  staff?: boolean;
  /** Owner screens sign in as the owner through the mock (`variant=me:owner`). */
  owner?: boolean;
  variant?: string;
}

const PROFILE = '/o/staff/01K86AFQDXWDHQ8238N67SVDDK';

const SHOTS: Shot[] = [
  // Staff
  { name: 'staff-today', path: '/', staff: true, ready: /Good morning/, full: true },
  {
    name: 'staff-today-ready',
    path: '/',
    staff: true,
    variant: 'meToday:ready',
    ready: /Good morning/,
  },
  {
    name: 'staff-today-checked-out',
    path: '/',
    staff: true,
    variant: 'meToday:checked-out',
    ready: /Good morning/,
  },
  { name: 'staff-month', path: '/month', staff: true, ready: 'Your month', full: true },
  { name: 'staff-day', path: '/day/2026-10-15', staff: true, ready: /15 Oct/, full: true },
  { name: 'staff-requests', path: '/requests', staff: true, ready: 'Requests', full: true },
  { name: 'staff-leave-form', path: '/requests/leave', staff: true, ready: 'Ask for leave' },
  { name: 'staff-payslips', path: '/payslips', staff: true, ready: 'Payslips', full: true },
  {
    name: 'staff-payslip',
    path: '/payslips/01K885FABFFQJST6Z99BWHFJAK',
    staff: true,
    ready: 'October 2026',
    full: true,
  },
  { name: 'staff-me', path: '/me', staff: true, ready: 'Me', full: true },
  { name: 'staff-sheet-locating', path: '/?sheet=locating', staff: true },
  { name: 'staff-sheet-pin', path: '/?sheet=pin', staff: true },
  { name: 'staff-sheet-success-in', path: '/?sheet=success-in', staff: true },
  { name: 'staff-sheet-outside', path: '/?sheet=outside', staff: true },
  { name: 'staff-install-ios', path: '/', ready: 'Add Feelings to your home screen' },
  { name: 'staff-signin', path: '/signin', staff: true },
  // Owner
  { name: 'owner-today', path: '/o/today', owner: true, full: true },
  { name: 'owner-actions', path: '/o/actions', owner: true, full: true },
  { name: 'owner-register', path: '/o/register', owner: true, full: true },
  { name: 'owner-staff', path: '/o/staff', owner: true, full: true },
  { name: 'owner-profile', path: PROFILE, owner: true, full: true },
  { name: 'owner-roster', path: '/o/roster?week=2026-W43', owner: true, full: true },
  { name: 'owner-payroll', path: '/o/payroll', owner: true, full: true },
  { name: 'owner-more', path: '/o/more', owner: true, full: true },
  { name: 'owner-settings', path: '/o/settings', owner: true, full: true },
  { name: 'owner-signin', path: '/auth/owner' },

  // Second pass: the screens behind the main tabs.
  { name: 'staff-fix-form', path: '/requests/fix', staff: true, full: true },
  { name: 'staff-my-data', path: '/me/data', staff: true, full: true },
  { name: 'staff-presence-history', path: '/me/data/presence', staff: true, full: true },
  { name: 'staff-privacy', path: '/me/privacy', staff: true, full: true },
  { name: 'staff-inbox', path: '/inbox', staff: true, full: true },
  { name: 'staff-fixit', path: '/fix/notifications', staff: true, full: true },
  { name: 'staff-join', path: '/join', staff: true },
  { name: 'staff-waiting', path: '/waiting', staff: true },
  { name: 'owner-setup', path: '/o/setup', owner: true, full: true },
  { name: 'owner-staff-new', path: '/o/staff/new', owner: true, full: true },
  { name: 'owner-duty-new', path: '/o/duties/new', owner: true, full: true },
  { name: 'owner-roll-call', path: '/o/roll-call', owner: true, full: true },
  { name: 'owner-credits', path: '/o/credits', owner: true, full: true },
  { name: 'owner-advances', path: '/o/advances', owner: true, full: true },
  { name: 'owner-reports', path: '/o/reports', owner: true, full: true },
  { name: 'owner-door-code', path: '/o/door-code', owner: true, full: true },
  { name: 'owner-inbox', path: '/o/inbox', owner: true, full: true },
  { name: 'owner-set-salon', path: '/o/settings/salon', owner: true, full: true },
  { name: 'owner-set-attendance', path: '/o/settings/attendance', owner: true, full: true },
  { name: 'owner-set-pay', path: '/o/settings/pay', owner: true, full: true },
  { name: 'owner-set-security', path: '/o/settings/security', owner: true, full: true },
  { name: 'owner-set-people', path: '/o/settings/people', owner: true, full: true },
  { name: 'owner-set-audit', path: '/o/settings/audit', owner: true, full: true },
  { name: 'owner-auth-add', path: '/auth/owner/add' },
  { name: 'owner-auth-recovery', path: '/auth/owner/recovery' },
];

/** Component kit sections, each saved on its own (the whole kit is taller than a PNG allows). */
const KIT = [
  'foundations',
  'buttons',
  'fields',
  'chips',
  'status',
  'stats',
  'cards',
  'lists',
  'overlays',
  'pinpad',
  'navigation',
] as const;

function url(s: Shot): string {
  const [base, query = ''] = s.path.split('?');
  const q = new URLSearchParams(query);
  q.set('mock', '1');
  if (s.staff) q.set('allowBrowser', '1');
  const variants = [s.owner ? 'me:owner' : '', s.variant ?? ''].filter(Boolean);
  if (variants.length > 0) q.set('variant', variants.join(','));
  return `${base}?${q}`;
}

async function open(page: Page, s: Shot): Promise<void> {
  await page.clock.setFixedTime(VISUAL_NOW);
  await page.route('https://tile.openstreetmap.org/**', (route) => route.abort());
  await page.goto(url(s));
  const soft = { timeout: 10_000 };
  try {
    if (s.ready) await expect(page.getByText(s.ready).first()).toBeVisible(soft);
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, soft);
    await expect(page.locator('.fs-skeleton')).toHaveCount(0, soft);
  } catch {
    // Captured anyway: the sheet then shows the screen as it was.
  }
  await page.evaluate(() => document.fonts.ready);
  // Let late queries (presence, notifications) land and the sheet finish opening.
  await page.waitForTimeout(800);
  await page.mouse.move(0, 0);
}

for (const s of SHOTS) {
  test(`shot ${s.name}`, async ({ page }, info) => {
    const dir = join(OUT, info.project.name);
    mkdirSync(dir, { recursive: true });
    await open(page, s);
    const opts = { animations: 'disabled', caret: 'hide' } as const;
    await page.screenshot({ ...opts, path: join(dir, `${s.name}.png`) });
    if (s.full)
      await page.screenshot({ ...opts, path: join(dir, `${s.name}--full.png`), fullPage: true });
  });
}

test('shot kit sections', async ({ page }, info) => {
  const dir = join(OUT, info.project.name);
  mkdirSync(dir, { recursive: true });
  await open(page, { name: 'kit', path: '/__kit' });
  for (const id of KIT) {
    const section = page.locator(`[data-kit-section="${id}"]`);
    if ((await section.count()) === 0) continue;
    await section.screenshot({
      animations: 'disabled',
      caret: 'hide',
      path: join(dir, `kit-${id}.png`),
    });
  }
});
