/**
 * Shared helpers for owner visual specs: open a screen on the fixtures as the owner with the fixed
 * clock, and make sure a crash page can never become a baseline.
 */
import type { Locator, Page } from '@playwright/test';
import { expect, VISUAL_NOW } from '../../fixtures';

export const OWNER_PROJECTS = new Set(['owner-phone', 'owner-desktop']);

/** Text that is visible inside the owner's main area (the rail also lists nav words). */
export const shown = (page: Page, text: string): Locator =>
  page.locator('#owner-main').getByText(text, { exact: true }).filter({ visible: true }).first();

/**
 * Open an owner screen in mock mode. Map tiles and the photo endpoints are cut off: the data comes
 * from the fixtures, and tiles would make the frame depend on the network.
 */
export async function openOwner(page: Page, path: string, variants: string[] = [], settle = true) {
  await page.clock.setFixedTime(VISUAL_NOW);
  await page.route('https://tile.openstreetmap.org/**', (route) => route.abort());
  await page.route(/\/api\/v1\/owner\/(staff\/[^/]+\/photo|punches\/[^/]+\/selfie)/, (route) =>
    route.abort(),
  );
  const variant = ['me:owner', ...variants].join(',');
  await page.goto(`${path}${path.includes('?') ? '&' : '?'}mock=1&variant=${variant}`);
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByTestId('owner-title')).toBeVisible();
  if (settle) await expect(page.locator('.fs-skeleton')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
}

/** No crash card and no React Router error page, right before a screenshot. */
export async function noCrash(page: Page) {
  await expect(page.getByTestId('owner-route-error')).toHaveCount(0);
  await expect(page.getByText('Unexpected Application Error')).toHaveCount(0);
  await expect(page.getByRole('main')).toBeVisible();
}
