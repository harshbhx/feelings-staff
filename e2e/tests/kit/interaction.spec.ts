/**
 * The interaction layer (docs/ui-redesign-plan.md 5a, "Enforcement and tests") on the kit page:
 * forced-state baselines of every role, the keyboard focus ring, pending with aria-busy and one
 * request for a double press, a disabled primary that names its reason, and reduced motion (no
 * transform transition, no vibration).
 */
import type { Page } from '@playwright/test';
import { expect, test } from '../../fixtures';

const BASELINE_PROJECTS = new Set(['staff-android', 'owner-desktop']);
const isPing = (url: URL) => url.pathname === '/__kit' && url.searchParams.get('action') === 'ping';
const TARGETS = '.fs-btn, .fs-chip, .fs-row, .fs-switch, .fs-tab, .fs-rail-item, .fs-icon-btn';
const FOCUS_TARGETS =
  '.fs-btn, .fs-chip__input, .fs-row, .fs-switch, .fs-tab, .fs-rail-item, .fs-icon-btn';

async function openKit(page: Page) {
  await page.goto('/__kit');
  await expect(page.getByRole('heading', { level: 1, name: 'Feelings Staff kit' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

/** Chrome's forced pseudo-classes (DevTools protocol) on every `data-kit-force` cell's control. */
async function forceStates(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
  for (const state of ['hover', 'active', 'focus-visible'] as const) {
    const targets = state === 'focus-visible' ? FOCUS_TARGETS : TARGETS;
    const selector = targets
      .split(', ')
      .map((t) => `[data-kit-force="${state}"] ${t}`)
      .join(', ');
    const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector });
    for (const nodeId of nodeIds)
      await cdp.send('CSS.forcePseudoState', {
        nodeId,
        forcedPseudoClasses: state === 'focus-visible' ? ['focus', 'focus-visible'] : [state],
      });
  }
}

test.describe('interaction layer', () => {
  test('INT-01 every role in rest, hover, pressed, focus, pending and disabled matches its baseline', async ({
    page,
  }, info) => {
    test.skip(!BASELINE_PROJECTS.has(info.project.name), 'baselines at 390 and 1280 only');
    await openKit(page);
    await page.mouse.move(0, 0);
    await forceStates(page);
    const section = page.locator('[data-kit-section="control-states"]');
    await section.scrollIntoViewIfNeeded();
    await expect(section).toHaveScreenshot('kit-control-states.png');
  });

  test('INT-02 the keyboard reaches each control with the 2 px sindoor ring', async ({
    page,
  }, info) => {
    test.skip(info.project.name === 'staff-ios', 'keyboard focus on desktop and Android');
    await openKit(page);
    await page.getByTestId('kit-live-action').focus();
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      const ring = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const s = getComputedStyle(el);
        return {
          style: s.outlineStyle,
          width: s.outlineWidth,
          color: s.outlineColor,
          tag: el.tagName,
        };
      });
      expect(ring, `focus ${i}`).not.toBeNull();
      expect(ring?.style, `focus ${i} on ${ring?.tag}`).toBe('solid');
      expect(ring?.width).toBe('2px');
      expect(ring?.color).toBe('rgb(179, 18, 27)');
    }
  });

  test('INT-03 pending: aria-busy while the request is out, one request for a double press', async ({
    page,
  }) => {
    await openKit(page);
    let calls = 0;
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => {
      release = r;
    });
    await page.route(isPing, async (route) => {
      calls++;
      await held;
      await route.fulfill({ status: 204 });
    });
    const button = page.getByTestId('kit-live-action');
    await button.dblclick();
    await expect(button).toHaveAttribute('aria-busy', 'true');
    await button.click({ force: true });
    expect(calls).toBe(1);
    release();
    await expect(page.getByText('Approved. Priya can check in now.')).toBeVisible();
    await expect(button).not.toHaveAttribute('aria-busy', 'true');
    expect(calls).toBe(1);
  });

  test('INT-04 a disabled primary names its reason, and the reason is read with it', async ({
    page,
  }) => {
    await openKit(page);
    const section = page.locator('[data-kit-section="control-states"]');
    const button = section.locator(
      '.fs-btn[data-variant="primary"][aria-disabled="true"]:not([aria-busy])',
    );
    await expect(button).toHaveCount(1);
    const reasonId = await button.getAttribute('aria-describedby');
    expect(reasonId).toBeTruthy();
    await expect(page.locator(`[id="${reasonId}"]`)).toHaveText('Check in opens at 09:00.');
    await expect(button).toHaveAccessibleDescription('Check in opens at 09:00.');
  });

  test('INT-05 reduced motion: no transform transition runs and nothing vibrates', async ({
    page,
  }, info) => {
    test.skip(info.project.name === 'staff-ios', 'WebKit has no Vibration API to spy on');
    await page.addInitScript(() => {
      const w = window as unknown as { __vibrations: unknown[]; __transitions: string[] };
      w.__vibrations = [];
      w.__transitions = [];
      Object.defineProperty(navigator, 'vibrate', {
        configurable: true,
        value: (p: unknown) => {
          w.__vibrations.push(p);
          return true;
        },
      });
      document.addEventListener('transitionrun', (e) => w.__transitions.push(e.propertyName), true);
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.route(isPing, (route) => route.fulfill({ status: 204 }));
    await openKit(page);
    const button = page.getByTestId('kit-live-action');
    await button.scrollIntoViewIfNeeded();
    await page.evaluate(() => {
      (window as unknown as { __transitions: string[] }).__transitions = [];
    });
    await button.click();
    await expect(page.getByText('Approved. Priya can check in now.')).toBeVisible();
    const seen = await page.evaluate(() => {
      const w = window as unknown as { __vibrations: unknown[]; __transitions: string[] };
      return { vibrations: w.__vibrations, transitions: w.__transitions };
    });
    expect(seen.transitions.filter((p) => /transform|scale|translate|rotate/.test(p))).toEqual([]);
    expect(seen.vibrations).toEqual([]);
  });

  test('INT-06 without reduced motion the approval ticks once (8 ms)', async ({ page }, info) => {
    test.skip(info.project.name === 'staff-ios', 'WebKit has no Vibration API to spy on');
    await page.addInitScript(() => {
      const w = window as unknown as { __vibrations: unknown[] };
      w.__vibrations = [];
      Object.defineProperty(navigator, 'vibrate', {
        configurable: true,
        value: (p: unknown) => {
          w.__vibrations.push(p);
          return true;
        },
      });
    });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.route(isPing, (route) => route.fulfill({ status: 204 }));
    await openKit(page);
    await page.getByTestId('kit-live-action').click();
    await expect(page.getByText('Approved. Priya can check in now.')).toBeVisible();
    expect(
      await page.evaluate(() => (window as unknown as { __vibrations: unknown[] }).__vibrations),
    ).toEqual([8]);
  });
});
