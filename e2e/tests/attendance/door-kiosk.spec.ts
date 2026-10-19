import { expect, test } from '../../fixtures';

test.describe('door kiosk (PRD 4.5)', () => {
  test('O-10.1 an unpaired screen asks for the 8-character pairing code', async ({
    page,
    reset,
    checkA11y,
  }) => {
    await reset('basic-salon');
    await page.goto('/door');
    await expect(page.getByRole('heading', { name: 'Set up the door screen' })).toBeVisible();
    await expect(page.getByLabel('Pairing code')).toBeVisible();
    await checkA11y(page);
  });

  test('O-10.1 a wrong pairing code is refused with a plain message', async ({ page, reset }) => {
    await reset('basic-salon');
    await page.goto('/door');
    await page.getByLabel('Pairing code').fill('ZZZZZZZZ');
    await page.getByRole('button', { name: 'Pair this screen' }).click();
    await expect(page.getByText('That code did not work')).toBeVisible();
  });

  // Needs the owner "Add door device" endpoint (WP-4 owner API, still answering 501) to get a code.
  test.fixme('O-10.2 a paired screen shows a token the API accepts and a countdown', async () => {});
});
