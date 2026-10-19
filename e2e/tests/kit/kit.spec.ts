/**
 * The component kit (PRD 12.6, 14.5): visual baselines at 390 px (staff-android) and 1280 px
 * (owner-desktop), axe on every project, and the one-font-preload budget (PRD 11.10).
 */
import type { Page } from '@playwright/test';
import { expect, test } from '../../fixtures';

const SECTIONS = [
  'foundations',
  'buttons',
  'fields',
  'chips',
  'status',
  'lists',
  'states',
  'overlays',
  'pinpad',
  'navigation',
] as const;

const BASELINE_PROJECTS = new Set(['staff-android', 'owner-desktop']);

async function openKit(page: Page) {
  await page.goto('/__kit');
  await expect(page.getByRole('heading', { level: 1, name: 'Feelings Staff kit' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

test.describe('kit', () => {
  test('KIT-01 every section matches its baseline at 390 and 1280', async ({ page }, info) => {
    test.skip(!BASELINE_PROJECTS.has(info.project.name), 'baselines at 390 and 1280 only');
    await openKit(page);
    // The toast sample is shown once on load; wait for it so the frame is stable.
    await expect(page.getByText("You're in at 10:02.", { exact: true }).first()).toBeVisible();
    for (const id of SECTIONS) {
      const section = page.locator(`[data-kit-section="${id}"]`);
      await section.scrollIntoViewIfNeeded();
      await expect(section).toHaveScreenshot(`kit-${id}.png`);
    }
  });

  test('KIT-02 axe finds no serious or critical violations', async ({ page, checkA11y }) => {
    await openKit(page);
    await checkA11y();
  });

  test('KIT-03 one font file is preloaded and it is the one the CSS uses', async ({ page }) => {
    await openKit(page);
    const preload = await page
      .locator('link[rel="preload"][as="font"]')
      .evaluateAll((links) => links.map((l) => (l as HTMLLinkElement).href));
    expect(preload).toHaveLength(1);
    expect(preload[0]).toMatch(/plus-jakarta-sans-latin-wght-normal.*\.woff2$/);
    const fetched = await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .map((e) => e.name)
        .filter((n) => n.includes('plus-jakarta-sans-latin-wght-normal')),
    );
    expect(fetched).toEqual([preload[0]]);
  });

  test('KIT-04 interactive controls have a 44 px target', async ({ page }) => {
    await openKit(page);
    const small = await page.evaluate(() => {
      const out: string[] = [];
      const sel =
        'button:not(.fs-pinpad__key[data-kind="delete"]:disabled), a[href], input, textarea';
      for (const el of document.querySelectorAll<HTMLElement>(`main ${sel}`)) {
        const target =
          el.closest('.fs-chip, .fs-input-wrap, .fs-pinpad__display') ?? (el as Element);
        const r = target.getBoundingClientRect();
        // Small buttons extend their target with ::after (2px above and below).
        const extra = el.matches('.fs-btn[data-size="sm"]') ? 4 : 0;
        if (r.width === 0 || r.height === 0) continue;
        if (r.height + extra < 43.5 || r.width < 43.5) {
          out.push(
            `${el.tagName.toLowerCase()} "${el.textContent?.trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`,
          );
        }
      }
      return out;
    });
    expect(small).toEqual([]);
  });

  test('KIT-05 radios in a chip group move with the arrow keys', async ({ page }, info) => {
    test.skip(
      info.project.name === 'staff-ios',
      'WebKit moves focus between form controls only with Option+Tab',
    );
    await openKit(page);
    const present = page.getByRole('radio', { name: 'Present 8' });
    await present.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('radio', { name: 'Late 2' })).toBeChecked();
    await expect(page.getByRole('radio', { name: 'Late 2' })).toBeFocused();
  });
});
