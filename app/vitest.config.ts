/**
 * Two test projects (WP-1):
 * - unit: client code under src/ in happy-dom.
 * - api: the Worker in workerd via @cloudflare/vitest-plugin, real D1 and R2 in Miniflare,
 *   migrations applied per test file (PRD 14.3). Secrets are throwaway values generated per run.
 */
import { fileURLToPath } from 'node:url';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';
import { generateTestSecrets } from '../scripts/gen-secrets.mjs';

const migrationsDir = fileURLToPath(new URL('../migrations', import.meta.url));

export default defineConfig({
  test: {
    coverage: {
      provider: 'istanbul',
      include: ['worker/**/*.ts'],
      exclude: ['worker/test/**', 'worker/**/*.test.ts'],
      reporter: ['text-summary', 'json-summary'],
    },
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.{ts,tsx}'],
          environment: 'happy-dom',
        },
      },
      {
        plugins: [
          cloudflareTest(async () => ({
            main: './worker/index.ts',
            miniflare: {
              compatibilityDate: '2026-10-01',
              compatibilityFlags: ['nodejs_compat'],
              d1Databases: ['DB'],
              r2Buckets: ['MEDIA'],
              // Same limits as wrangler.jsonc; only active for a request with X-FS-Test-RateLimit: on.
              ratelimits: {
                RL_IP: { namespace_id: '4101', simple: { limit: 300, period: 60 } },
                RL_SESSION: { namespace_id: '4102', simple: { limit: 120, period: 60 } },
                RL_PUNCH: { namespace_id: '4103', simple: { limit: 6, period: 60 } },
                RL_DOOR: { namespace_id: '4104', simple: { limit: 12, period: 60 } },
              },
              bindings: {
                ENV: 'local',
                APP_ORIGIN: 'https://staff.test',
                APP_VERSION: '0.1.0',
                MIN_APP_VERSION: '0.1.0',
                EMAIL_PROVIDER: 'outbox',
                EMAIL_FROM: 'Feelings Staff <staff@feelingsbeautycare.in>',
                VAPID_SUBJECT: 'mailto:staff@feelingsbeautycare.in',
                OWNER_BOOTSTRAP_EMAIL: 'owner@feelings.test',
                ...generateTestSecrets(),
                TEST_MIGRATIONS: await readD1Migrations(migrationsDir),
              },
            },
          })),
        ],
        test: {
          name: 'api',
          include: ['worker/**/*.test.ts'],
          setupFiles: ['./worker/test/setup.ts'],
        },
      },
    ],
  },
});
