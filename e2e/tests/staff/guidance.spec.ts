/**
 * The guidance layer (iOS redesign): the compulsory install gate, the slim hint on a computer, and
 * the first-login tour. Automated browsers are left alone by default, so each test turns the layer
 * on the way a person's browser would: `installGate=1` for the gate, `guide=1` for the tour.
 * No screenshots here (the gate has baselines in visual.spec.ts, every state is in the ios-shots job).
 */
import type { Page } from '@playwright/test';
import { expect, test, VISUAL_NOW } from '../../fixtures';

const IOS_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

type Fake = Window & { __standalone?: boolean; __fire?: () => void };

const staff = (name: string) => name.startsWith('staff-');

test.describe('install gate', () => {
  test.use({ userAgent: IOS_SAFARI });

  test('GATE-1 a phone browser tab gets the gate: no way to dismiss it, it stays on every screen and reload', async ({
    page,
  }, info) => {
    test.skip(!staff(info.project.name), 'staff projects');
    await page.clock.setFixedTime(VISUAL_NOW);
    await page.goto('/?mock=1&installGate=1');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Install Feelings to continue' }),
    ).toBeVisible();
    await expect(page.getByText('Tap the Share button')).toBeVisible();
    // Nothing to press: no close, later or skip.
    await expect(page.getByRole('button')).toHaveCount(0);
    await page.goto('/month?mock=1');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Install Feelings to continue' }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Install Feelings to continue' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Your month' })).toHaveCount(0);
  });

  test('GATE-2 the gate clears when the page starts running standalone', async ({ page }, info) => {
    test.skip(!staff(info.project.name), 'staff projects');
    await page.clock.setFixedTime(VISUAL_NOW);
    await page.addInitScript(() => {
      const w = window as Fake;
      const real = window.matchMedia.bind(window);
      const callbacks = new Set<() => void>();
      w.__standalone = false;
      w.__fire = () => {
        for (const cb of callbacks) cb();
      };
      window.matchMedia = (q: string) => {
        if (!q.includes('display-mode: standalone')) return real(q);
        return {
          get matches() {
            return w.__standalone === true;
          },
          media: q,
          onchange: null,
          addEventListener: (_t: string, cb: () => void) => callbacks.add(cb),
          removeEventListener: (_t: string, cb: () => void) => callbacks.delete(cb),
          addListener: () => undefined,
          removeListener: () => undefined,
          dispatchEvent: () => false,
        } as unknown as MediaQueryList;
      };
    });
    await page.goto('/?mock=1&installGate=1');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Install Feelings to continue' }),
    ).toBeVisible();
    await page.evaluate(() => {
      const w = window as Fake;
      w.__standalone = true;
      w.__fire?.();
    });
    await expect(
      page.getByRole('heading', { level: 1, name: /Good morning, Priya/ }),
    ).toBeVisible();
    await expect(page.getByText('Install Feelings to continue')).toHaveCount(0);
  });

  test('GATE-3 automated browsers are not gated unless asked to be', async ({ page }, info) => {
    test.skip(!staff(info.project.name), 'staff projects');
    await page.clock.setFixedTime(VISUAL_NOW);
    await page.goto('/?mock=1');
    await expect(
      page.getByRole('heading', { level: 1, name: /Good morning, Priya/ }),
    ).toBeVisible();
    await expect(page.getByText('Install Feelings to continue')).toHaveCount(0);
  });

  test('GATE-4 the owner panel is gated on a phone too', async ({ page }, info) => {
    test.skip(info.project.name !== 'owner-phone', 'owner phone project');
    await page.clock.setFixedTime(VISUAL_NOW);
    await page.goto('/o/today?mock=1&variant=me:owner&installGate=1');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Install Feelings to continue' }),
    ).toBeVisible();
    await expect(page.getByTestId('owner-title')).toHaveCount(0);
  });
});

test.describe('install hint on a computer', () => {
  test.use({
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    isMobile: false,
    hasTouch: false,
  });

  test('GATE-5 a computer is never blocked: the app shows under a slim hint that can be hidden', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'owner-desktop', 'one run is enough');
    await page.clock.setFixedTime(VISUAL_NOW);
    await page.goto('/o/today?mock=1&variant=me:owner&installGate=1');
    await expect(page.getByTestId('owner-title').first()).toBeVisible();
    await expect(page.getByText('Feelings is made for phones.')).toBeVisible();
    await page.getByRole('button', { name: 'Hide' }).click();
    await expect(page.getByText('Feelings is made for phones.')).toHaveCount(0);
  });
});

async function skipTourIfShown(page: Page): Promise<void> {
  const tour = page.getByRole('dialog', { name: 'Welcome to Feelings' });
  await expect(tour).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Skip tour' }).click();
  await expect(page.getByTestId('tour')).toHaveCount(0);
}

test.describe('first-login tour', () => {
  test('TOUR-1 staff: welcome, a lit step, focus stays in the card, skipping is remembered', async ({
    page,
  }, info) => {
    test.skip(!staff(info.project.name), 'staff projects');
    await page.clock.setFixedTime(VISUAL_NOW);
    await page.goto('/?mock=1&allowBrowser=1&guide=1');
    const tour = page.getByRole('dialog', { name: 'Welcome to Feelings' });
    await expect(tour).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Show me around' }).click();
    const step = page.getByTestId('tour').getByRole('dialog');
    await expect(step.getByRole('heading', { name: 'Today' })).toBeVisible();
    await expect(page.getByText('Step 1 of 5')).toBeVisible();
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Tab');
      await expect(page.getByTestId('tour').locator(':focus')).toHaveCount(1);
    }
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText('Step 2 of 5')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('tour')).toHaveCount(0);
    // Seen: it does not come back on the next load.
    await page.reload();
    await expect(
      page.getByRole('heading', { level: 1, name: /Good morning, Priya/ }),
    ).toBeVisible();
    await page.waitForTimeout(5000);
    await expect(page.getByTestId('tour')).toHaveCount(0);
  });

  test('TOUR-2 staff: it can be replayed from Me', async ({ page }, info) => {
    test.skip(!staff(info.project.name), 'staff projects');
    await page.clock.setFixedTime(VISUAL_NOW);
    await page.goto('/me?mock=1&allowBrowser=1&guide=1');
    await skipTourIfShown(page);
    await page.getByRole('button', { name: /Replay the tour/ }).click();
    await expect(page.getByRole('dialog', { name: 'Welcome to Feelings' })).toBeVisible();
  });

  test('TOUR-3 owner: its own steps, replayable from More', async ({ page }, info) => {
    test.skip(!info.project.name.startsWith('owner-'), 'owner projects');
    await page.clock.setFixedTime(VISUAL_NOW);
    await page.goto('/o/today?mock=1&variant=me:owner&guide=1');
    const tour = page.getByRole('dialog', { name: 'Welcome to Feelings' });
    await expect(tour).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Show me around' }).click();
    await expect(page.getByTestId('tour').getByRole('heading', { name: 'Today' })).toBeVisible();
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(
      page.getByTestId('tour').getByRole('heading', { name: 'Needs action' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Skip tour' }).click();
    await expect(page.getByTestId('tour')).toHaveCount(0);
    await page.goto('/o/more?mock=1&variant=me:owner');
    await page.getByRole('button', { name: /Replay the tour/ }).click();
    await expect(page.getByRole('dialog', { name: 'Welcome to Feelings' })).toBeVisible();
  });
});
