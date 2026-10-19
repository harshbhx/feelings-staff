/**
 * Staff presence (PRD 4.18.1, 4.18.4; S-24; E2E-24 to E2E-26, staff half) at 390 px: Step out next
 * to Check out, the Step out sheet, the away card after a step-out and after a roll-call Not here,
 * I'm back, one note, the one-time notice, and no credit words anywhere a staff member looks.
 * Mock mode with the clock at 10:42 IST on 19 Oct 2026; variants from packages/contracts/fixtures
 * (mePresence:stepped-out, mePresence:marked-away, mePresence:consent-needed).
 *
 * Baselines: `gh workflow run snapshots -f ref=<branch> -f grep=STAFF-PRES`.
 */
import type { Page, TestInfo } from '@playwright/test';
import { expect, test, VISUAL_NOW } from '../../fixtures';

function staffOnly(info: TestInfo): void {
  test.skip(!info.project.name.startsWith('staff-'), 'staff screens run on the staff projects');
}

const android = (info: TestInfo) => info.project.name === 'staff-android';

async function openToday(page: Page, variants: string[] = [], path = '/'): Promise<void> {
  await page.clock.setFixedTime(VISUAL_NOW);
  const q = new URLSearchParams({ mock: '1', allowBrowser: '1' });
  if (variants.length > 0) q.set('variant', variants.join(','));
  await page.goto(`${path}?${q}`);
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
}

const bar = (page: Page) => page.locator('.staff-actionbar');

test.describe('staff presence', () => {
  test('STAFF-PRES S-24.2 checked in: Step out sits next to Check out, axe clean', async ({
    page,
    checkA11y,
  }, info) => {
    staffOnly(info);
    await openToday(page);
    await expect(bar(page).getByRole('button', { name: 'Check out' })).toBeVisible();
    await expect(bar(page).getByRole('button', { name: 'Step out' })).toBeVisible();
    if (android(info)) await expect(page).toHaveScreenshot('staff-presence-today.png');
    await checkA11y();
  });

  test('STAFF-PRES S-24.2 Step out takes a reason chip and an optional note', async ({
    page,
    checkA11y,
  }, info) => {
    staffOnly(info);
    await openToday(page);
    await bar(page).getByRole('button', { name: 'Step out' }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByTestId('step-out-sheet')).toBeVisible();
    for (const chip of ['Personal', 'Lunch outside', 'Work errand', 'Other'])
      await expect(sheet.getByText(chip, { exact: true })).toBeVisible();
    if (android(info)) await expect(page).toHaveScreenshot('staff-presence-step-out.png');
    await checkA11y();
    await sheet.getByRole('button', { name: 'Step out now' }).click();
    await expect(sheet.getByText('Pick one reason.')).toBeVisible();
    await sheet.getByText('Work errand', { exact: true }).click();
    await sheet.getByLabel('Note for Urmi').fill('Bank for the salon');
    await sheet.getByRole('button', { name: 'Step out now' }).click();
    // The server's answer (presenceStepOut.json, 09:32) becomes the card at once.
    await expect(page.getByTestId('presence-away')).toContainText("You're out since 09:32");
    await expect(bar(page).getByRole('button', { name: "I'm back" })).toBeVisible();
  });

  test("STAFF-PRES E2E-25 stepped out: the card, then I'm back with the minutes", async ({
    page,
    checkA11y,
  }, info) => {
    staffOnly(info);
    await openToday(page, ['mePresence:stepped-out']);
    const card = page.getByTestId('presence-away');
    await expect(card).toContainText("You're out since 09:32");
    await expect(card).toContainText('Work errand');
    await expect(bar(page).getByRole('button', { name: 'Step out' })).toHaveCount(0);
    if (android(info)) await expect(page).toHaveScreenshot('staff-presence-out.png');
    await checkA11y();
    await bar(page).getByRole('button', { name: "I'm back" }).click();
    await expect(page.getByText('Welcome back. You were out 25 min.')).toBeVisible();
  });

  test('STAFF-PRES S-24.3 E2E-24 marked away by the owner, one note, I am back', async ({
    page,
    checkA11y,
  }, info) => {
    staffOnly(info);
    await openToday(page, ['mePresence:marked-away']);
    const card = page.getByTestId('presence-away');
    await expect(card).toContainText('Urmi marked you away since 09:32');
    if (android(info)) await expect(page).toHaveScreenshot('staff-presence-marked.png');
    await checkA11y();
    await card.getByRole('button', { name: 'Add a note' }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByRole('button', { name: 'Send note' }).click();
    await expect(sheet.getByText('Write a few words first.')).toBeVisible();
    await sheet.getByLabel('Your note').fill('I was at the back, washing towels');
    await sheet.getByRole('button', { name: 'Send note' }).click();
    await expect(page.getByText('Note sent to Urmi.')).toBeVisible();
    await bar(page).getByRole('button', { name: "I'm back" }).click();
    await expect(page.getByText(/^Welcome back\. You were out \d+ min\.$/)).toBeVisible();
  });

  test('STAFF-PRES S-24.1 E2E-26 the presence notice shows once', async ({
    page,
    checkA11y,
  }, info) => {
    staffOnly(info);
    await openToday(page, ['mePresence:consent-needed']);
    const notice = page.getByTestId('presence-consent');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('Nothing is cut automatically.');
    await expect(notice).toContainText('No route, no map trail.');
    if (android(info)) await expect(page).toHaveScreenshot('staff-presence-consent.png');
    await checkA11y();
    await notice.getByRole('button', { name: 'OK, I understand' }).click();
    await expect(notice).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await expect(page.getByTestId('presence-consent')).toHaveCount(0);
  });

  test('STAFF-PRES E2E-26 privacy: no credit words on any staff screen', async ({ page }, info) => {
    staffOnly(info);
    const visits: [string, string[]][] = [
      ['/', []],
      ['/', ['mePresence:stepped-out']],
      ['/', ['mePresence:marked-away']],
      ['/month', []],
      ['/day/2026-10-15', []],
      ['/requests', []],
    ];
    for (const [path, variants] of visits) {
      await openToday(page, variants, path);
      const text = await page.locator('body').innerText();
      expect(text, `${path} ${variants.join(',')}`).not.toMatch(/\bcredits?\b|time credit/i);
    }
  });
});
