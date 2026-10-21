/**
 * E2E-01 Owner setup checklist, end to end (PRD 4.15.1, 14.4; O-02): the owner opens the checklist
 * with every step still to do, goes through each step page, marks six as done and two as skipped,
 * and ends on "You're ready" with a way to Today. The owner signs in through the API (password,
 * PIN, step-up) and the browser takes over that session.
 *
 * Selectors are roles, labels and test ids only, so the UI redesign cannot break them.
 */
import type { SetupStep } from '@fs/contracts';
import { expect, test } from '../../fixtures';
import { ownerSession } from '../flows/helpers';

const STEPS: SetupStep[] = [
  'salon',
  'location',
  'shifts',
  'holidays',
  'pay_rules',
  'selfie',
  'first_staff',
  'install',
];

/** Each step: the title shown on its page, and the button that finishes it. */
const FLOW: { step: SetupStep; title: string; finish: string; skip: boolean }[] = [
  { step: 'salon', title: 'Salon details', finish: 'Looks right', skip: false },
  { step: 'location', title: 'Salon location', finish: 'Looks right', skip: false },
  { step: 'shifts', title: 'Shifts', finish: 'These are right', skip: false },
  { step: 'holidays', title: 'Holidays', finish: 'These are right', skip: false },
  { step: 'pay_rules', title: 'Pay rules', finish: 'Use these', skip: false },
  { step: 'selfie', title: 'Selfie on check-in', finish: 'Done', skip: true },
  { step: 'first_staff', title: 'Your first staff member', finish: 'Done', skip: false },
  { step: 'install', title: 'This phone', finish: 'Done', skip: true },
];

test.beforeEach(async ({ page: _page }, testInfo) => {
  test.skip(testInfo.project.name !== 'owner-desktop', 'One owner screen flow; runs once');
});

test.describe('E2E-01 owner setup checklist', () => {
  test('E2E-01 every step opens, is marked done or skipped, and the checklist ends ready', async ({
    page,
    context,
    request,
    reset,
  }) => {
    test.setTimeout(180_000);
    const seeded = await reset('basic-salon');
    const owner = await ownerSession(request, seeded.owner);
    // The demo salon starts finished; put the checklist back to a first run.
    for (const step of STEPS) {
      await owner.ok('POST', `/owner/setup/steps/${step}`, { state: 'todo' });
    }
    const fresh = await owner.ok<{ steps: Record<string, string>; complete: boolean }>(
      'GET',
      '/owner/setup',
    );
    expect(fresh.complete).toBe(false);
    await context.addCookies((await request.storageState()).cookies);

    await page.goto('/o/setup');
    await expect(page.getByRole('progressbar', { name: '0 of 8 done' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("A few quick things, then you're ready.")).toBeVisible();
    for (const f of FLOW) {
      await expect(page.getByText(f.title, { exact: true }).first()).toBeVisible();
    }

    // The primary button leads to the first open step; each step page finishes or skips.
    await page.getByRole('link', { name: 'Next: Salon details' }).click();
    for (const [i, f] of FLOW.entries()) {
      await expect(page).toHaveURL(new RegExp(`step=${f.step}$`));
      await expect(page.getByTestId('owner-title')).toHaveText(f.title);
      const button = f.skip
        ? page.getByRole('button', { name: 'Skip for now' })
        : page.getByRole('button', { name: f.finish, exact: true });
      await expect(button).toBeEnabled({ timeout: 30_000 });
      await button.click();
      if (i < FLOW.length - 1) {
        const next = FLOW[i + 1];
        await expect(page).toHaveURL(new RegExp(`step=${next?.step}$`));
      }
    }

    // Back on the checklist: all handled, ready, and a way to Today.
    await expect(page).toHaveURL(/\/o\/setup$/);
    await expect(page.getByRole('progressbar', { name: '8 of 8 done' })).toBeVisible();
    await expect(
      page.getByText("You're ready. Change any of this later in Settings."),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Go to Today' })).toBeVisible();

    const after = await owner.ok<{ steps: Record<string, string>; complete: boolean }>(
      'GET',
      '/owner/setup',
    );
    expect(after.complete).toBe(true);
    expect(after.steps).toMatchObject({
      salon: 'done',
      location: 'done',
      shifts: 'done',
      holidays: 'done',
      pay_rules: 'done',
      selfie: 'skipped',
      first_staff: 'done',
      install: 'skipped',
    });
    await page.getByRole('link', { name: 'Go to Today' }).click();
    await expect(page).toHaveURL(/\/o\/today$/);
  });
});
