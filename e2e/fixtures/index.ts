/**
 * Shared E2E fixtures (WP-1): test-route helpers, geolocation presets, axe, and visual helpers.
 *
 *   import { test, expect, GEO } from '../fixtures';
 *   test('E2E-04 ...', async ({ page, reset, setGeo }) => { const s = await reset('basic-salon'); ... });
 */
import AxeBuilder from '@axe-core/playwright';
import type { TestResetResult, TestScenario } from '@fs/contracts';
import { test as base, expect, type Page } from '@playwright/test';

export { expect };

/** PRD 14.4 geolocation scenarios around the salon pin 22.4606479, 70.0565093. */
export const GEO = {
  inside: { latitude: 22.4606479, longitude: 70.0565093, accuracy: 18 },
  edge: { latitude: 22.4613, longitude: 70.0571, accuracy: 60 },
  outside: { latitude: 22.4637, longitude: 70.0565093, accuracy: 20 },
  approximate: { latitude: 22.47, longitude: 70.06, accuracy: 1500 },
} as const;

/** Fixed visual-test time: 10:42 IST on 19 Oct 2026. */
export const VISUAL_NOW = Date.parse('2026-10-19T10:42:00+05:30');

const E2E_TOKEN = process.env.E2E_TOKEN ?? '';

interface Fixtures {
  reset(scenario?: TestScenario): Promise<TestResetResult>;
  setServerClock(nowMs: number | null): Promise<void>;
  runCron(job: 'rules' | 'nightly', at?: number): Promise<unknown>;
  outbox(): Promise<{ channel: string; to: string; at: number; payload: unknown }[]>;
  setGeo(where: keyof typeof GEO): Promise<void>;
  checkA11y(page?: Page): Promise<void>;
}

export const test = base.extend<Fixtures>({
  reset: async ({ request }, use) => {
    await use(async (scenario = 'basic-salon') => {
      const res = await request.post('/api/v1/__test/reset', {
        data: { scenario },
        headers: {
          'X-E2E-Token': E2E_TOKEN,
          'X-FS-Client': '0.1.0',
          Origin: 'http://localhost:8787',
        },
      });
      expect(res.status(), await res.text()).toBe(200);
      return (await res.json()) as TestResetResult;
    });
  },
  setServerClock: async ({ request }, use) => {
    await use(async (nowMs) => {
      const res = await request.post('/api/v1/__test/clock', {
        data: { nowMs },
        headers: {
          'X-E2E-Token': E2E_TOKEN,
          'X-FS-Client': '0.1.0',
          Origin: 'http://localhost:8787',
        },
      });
      expect(res.status()).toBe(200);
    });
  },
  runCron: async ({ request }, use) => {
    await use(async (job, at) => {
      const res = await request.post('/api/v1/__test/cron', {
        data: at === undefined ? { job } : { job, at },
        headers: {
          'X-E2E-Token': E2E_TOKEN,
          'X-FS-Client': '0.1.0',
          Origin: 'http://localhost:8787',
        },
      });
      expect(res.status()).toBe(200);
      return res.json();
    });
  },
  outbox: async ({ request }, use) => {
    await use(async () => {
      const res = await request.get('/api/v1/__test/outbox', {
        headers: { 'X-E2E-Token': E2E_TOKEN },
      });
      expect(res.status()).toBe(200);
      return (
        (await res.json()) as {
          items: { channel: string; to: string; at: number; payload: unknown }[];
        }
      ).items;
    });
  },
  setGeo: async ({ context }, use) => {
    await use(async (where) => {
      await context.grantPermissions(['geolocation']);
      await context.setGeolocation(GEO[where]);
    });
  },
  checkA11y: async ({ page }, use) => {
    await use(async (p = page) => {
      const results = await new AxeBuilder({ page: p })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      const bad = results.violations.filter(
        (v) => v.impact === 'serious' || v.impact === 'critical',
      );
      expect(
        bad.map(
          (v) =>
            `${v.id}: ${v.help} (${v.nodes.length}) ${v.nodes
              .slice(0, 3)
              .map((n) => `${n.target.join(' ')} [${n.any[0]?.message ?? n.html.slice(0, 80)}]`)
              .join(' | ')}`,
        ),
      ).toEqual([]);
    });
  },
});
