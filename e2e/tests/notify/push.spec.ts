import { expect, test } from '../../fixtures';

/**
 * E2E-19 (PRD 14.4): subscribe from a tap, the server sends N2, the service worker shows it, a
 * click navigates to the target. Needs WP-7's service worker (it imports registerPushHandlers) and
 * the staff and owner shells, so it stays fixme until they are on main. The server half is already
 * covered by the Workers API tests (notifier.matrix.test.ts, notify.test.ts).
 */
test.describe('E2E-19 push', () => {
  test.fixme('subscribe from a tap, receive N2, click opens the register day', async ({
    page,
    context,
    reset,
    setServerClock,
    outbox,
  }) => {
    await context.grantPermissions(['notifications']);
    await reset('basic-salon');
    await setServerClock(Date.parse('2026-10-19T10:28:00+05:30'));
    await page.goto('/o/today');
    await page.getByRole('button', { name: /turn on notifications/i }).click();
    await expect
      .poll(async () => (await outbox()).filter((o) => o.channel === 'push').length)
      .toBe(0);
    // The staff member checks in late; the punch emits N2 to the owner.
    // (Filled in once the punch flow and shells land.)
    await expect(page.getByText('Priya is 18 min late')).toBeVisible();
    await page.getByText('Priya is 18 min late').click();
    await expect(page).toHaveURL(/\/o\/register\/.+\/2026-10-19/);
  });
});
