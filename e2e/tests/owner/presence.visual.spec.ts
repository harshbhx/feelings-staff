/**
 * Owner presence (PRD 4.18, 4.19.5, 5.2 Roll-call; O-30; E2E-24 and E2E-25, owner half) at 390 px
 * (owner-phone) and 1280 px (owner-desktop): the roll-call card on Today, the Roll-call view and
 * list, Needs-action away items with Confirm / Mark as work / Ignore, the edit sheet, and Settings
 * -> Presence. Mock mode with the clock at 10:42 IST on 19 Oct 2026; the variants come from
 * packages/contracts/fixtures (ownerToday:roll-call-open, ownerRollCallGet:open, ownerActions:away).
 *
 * Baselines: `gh workflow run snapshots -f ref=<branch> -f grep=OWN-PRES`.
 */
import type { Page } from '@playwright/test';
import { expect, test } from '../../fixtures';
import { noCrash, OWNER_PROJECTS, openOwner, shown } from './helpers';

/** The 10:30 roll-call of the fixtures (ownerToday.roll-call-open, ownerRollCallGet.open). */
const ROLL_CALL = '/o/roll-call/01K8WP9RC40000000000000000';

const rows = (page: Page) => page.getByTestId('roll-call-row');
const summary = (page: Page) => page.getByTestId('roll-call-summary');

test.describe('owner presence', () => {
  test.beforeEach(({ page: _page }, info) => {
    test.skip(!OWNER_PROJECTS.has(info.project.name), 'owner screens at 390 and 1280 only');
  });

  test('OWN-PRES E2E-24 Today: an open roll-call asks who is not here', async ({
    page,
    checkA11y,
  }) => {
    await openOwner(page, '/o/today', ['ownerToday:roll-call-open']);
    const card = page.getByTestId('today-roll-call');
    await expect(card).toContainText('Roll-call at 10:30 is open');
    await expect(card).toContainText("Who's not here? It takes about 20 seconds.");
    await noCrash(page);
    await expect(page).toHaveScreenshot('owner-today-rollcall.png', { fullPage: true });
    await checkA11y();
    await card.getByRole('link', { name: 'Start roll-call' }).click();
    await expect(page).toHaveURL(new RegExp(`${ROLL_CALL}$`));
  });

  test('OWN-PRES O-30 Today: away now, since when and why, with Edit times', async ({
    page,
    checkA11y,
  }) => {
    await openOwner(page, '/o/today', ['ownerAwayList:open']);
    const away = page.getByTestId('today-away-now');
    await expect(away).toContainText('Dhara Gohil');
    await expect(away).toContainText('Stepped out at 10:24');
    await expect(away).toContainText('Lunch outside');
    await noCrash(page);
    await expect(page).toHaveScreenshot('owner-today-away.png', { fullPage: true });
    await checkA11y();
    await away.getByRole('button', { name: 'Edit times' }).click();
    await expect(page.getByRole('dialog').getByLabel('Back at')).toHaveValue('');
  });

  test('OWN-PRES O-30 Today: a missed roll-call says it is not done', async ({ page }) => {
    await openOwner(page, '/o/today', ['ownerToday:roll-call-missed']);
    await expect(page.getByTestId('today-roll-call')).toContainText('Roll-call at 10:00 not done');
    await noCrash(page);
    await expect(page).toHaveScreenshot('owner-today-rollcall-missed.png', { fullPage: true });
  });

  test('OWN-PRES O-30.2 roll-call: everyone checked in defaults to Here, axe clean', async ({
    page,
    checkA11y,
  }) => {
    await openOwner(page, ROLL_CALL, ['ownerRollCallGet:open']);
    await expect(rows(page)).toHaveCount(8);
    // Dhara stepped out at 10:24 and is still out: she stays Not here until someone taps Here.
    await expect(rows(page).filter({ hasText: 'Dhara Gohil' })).toHaveAttribute(
      'data-mark',
      'not_here',
    );
    await expect(summary(page)).toHaveText('7 here · 1 not here');
    await expect(shown(page, 'Seems away')).toBeVisible();
    await expect(shown(page, 'On break')).toBeVisible();
    await noCrash(page);
    await expect(page).toHaveScreenshot('owner-rollcall.png', { fullPage: true });
    await checkA11y();
  });

  test('OWN-PRES E2E-24 roll-call: tap one person Not here, Done saves', async ({ page }) => {
    await openOwner(page, ROLL_CALL, ['ownerRollCallGet:open']);
    const sejal = rows(page).filter({ hasText: 'Sejal Makwana' });
    await sejal.click();
    await expect(sejal).toHaveAttribute('data-mark', 'not_here');
    await expect(summary(page)).toHaveText('6 here · 2 not here');
    await expect(page).toHaveScreenshot('owner-rollcall-marked.png', { fullPage: true });
    // The keyboard works the same way: Space on the focused row switches it back.
    await sejal.locator('input').focus();
    await page.keyboard.press('Space');
    await expect(sejal).toHaveAttribute('data-mark', 'here');
    await sejal.click();
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(
      page.getByText('Roll-call at 10:30 saved: 6 here, 2 not here.', { exact: true }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/o\/today/);
  });

  test('OWN-PRES O-30 roll-call: nobody checked in', async ({ page }) => {
    await openOwner(page, ROLL_CALL, ['ownerRollCallGet:empty']);
    await expect(shown(page, 'Nobody is checked in.')).toBeVisible();
    await noCrash(page);
    await expect(page).toHaveScreenshot('owner-rollcall-empty.png');
  });

  test('OWN-PRES roll-call: loading keeps the layout', async ({ page }) => {
    await openOwner(page, ROLL_CALL, ['ownerRollCallGet:loading'], false);
    await expect(page.locator('#owner-main .fs-skeleton').first()).toBeVisible();
    await noCrash(page);
    await expect(page).toHaveScreenshot('owner-rollcall-loading.png');
  });

  test('OWN-PRES roll-call: error card in plain words', async ({ page, checkA11y }) => {
    await openOwner(page, ROLL_CALL, ['ownerRollCallGet:error']);
    await expect(page.getByTestId('owner-error')).toBeVisible();
    await noCrash(page);
    await expect(page).toHaveScreenshot('owner-rollcall-error.png');
    await checkA11y();
  });

  test("OWN-PRES O-30.10 roll-call list: today's slots and who did them", async ({
    page,
    checkA11y,
  }) => {
    await openOwner(page, '/o/roll-call');
    await expect(shown(page, 'Done by Urmi')).toBeVisible();
    await expect(shown(page, 'Opens at 15:00')).toBeVisible();
    await noCrash(page);
    await expect(page).toHaveScreenshot('owner-rollcall-list.png', { fullPage: true });
    await checkA11y();
  });

  test('OWN-PRES E2E-25 Needs action: pending step-outs with Confirm, Mark as work, Ignore', async ({
    page,
    checkA11y,
  }) => {
    await openOwner(page, '/o/actions', ['ownerActions:away']);
    const items = page.getByTestId('action-away');
    await expect(items).toHaveCount(3);
    await expect(items.first()).toContainText('Mark as work');
    await expect(shown(page, "I'm back missing")).toBeVisible();
    await expect(shown(page, '“Bank for the salon”')).toBeVisible();
    await noCrash(page);
    await expect(page).toHaveScreenshot('owner-actions-away.png', { fullPage: true });
    await checkA11y();
  });

  test('OWN-PRES E2E-25 Mark as work takes the item off the queue', async ({ page }) => {
    await openOwner(page, '/o/actions', ['ownerActions:away']);
    const items = page.getByTestId('action-away');
    const meena = items.filter({ hasText: 'Meena' });
    await meena.getByRole('button', { name: 'Mark as work' }).click();
    // The item leaves the queue at once (the mock queue comes back on the next refetch).
    await expect(items).toHaveCount(2);
  });

  test('OWN-PRES O-30.4 edit sheet: start, end, reason, how it counts, a reason for the change', async ({
    page,
    checkA11y,
  }) => {
    await openOwner(page, '/o/actions', ['ownerActions:away']);
    const pooja = page.getByTestId('action-away').filter({ hasText: 'Pooja' });
    await pooja.getByRole('button', { name: 'Edit times' }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByLabel('Out from')).toHaveValue('10:04');
    await expect(sheet.getByLabel('Back at')).toHaveValue('10:20');
    await expect(page).toHaveScreenshot('owner-away-edit.png');
    await checkA11y();
    await sheet.getByRole('button', { name: 'Save change' }).click();
    await expect(sheet.getByText('Say why, in a few words.')).toBeVisible();
    await sheet.getByLabel('Back at').fill('10:00');
    await sheet.getByLabel('Why the change').fill('She came back earlier, I saw her');
    await sheet.getByRole('button', { name: 'Save change' }).click();
    await expect(sheet.getByText('Back at must be after Out from.')).toBeVisible();
    await sheet.getByLabel('Back at').fill('10:15');
    await sheet.getByRole('button', { name: 'Save change' }).click();
    await expect(
      page.getByText("Saved. Pooja's time away is updated.", { exact: true }),
    ).toBeVisible();
  });

  test('OWN-PRES O-30.10 Settings, Presence: times, Step out, quiet check, axe clean', async ({
    page,
    checkA11y,
  }) => {
    await openOwner(page, '/o/settings/presence');
    await expect(page.getByRole('textbox', { name: 'Roll-call 1' })).toHaveValue('12:00');
    await expect(page.getByRole('textbox', { name: 'Roll-call 3' })).toHaveValue('18:00');
    await noCrash(page);
    await expect(page).toHaveScreenshot('owner-settings-presence.png', { fullPage: true });
    await checkA11y();
    await page.getByRole('button', { name: 'Add a time' }).click();
    await expect(page.getByRole('textbox', { name: 'Roll-call 4' })).toHaveValue('19:00');
    await expect(page.getByRole('button', { name: 'Add a time' })).toHaveCount(0);
    await page.getByRole('textbox', { name: 'Roll-call 4' }).fill('11:00');
    await expect(
      page.getByText('Put the times in order, each after the one before.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});
