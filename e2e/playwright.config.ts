/**
 * Playwright (PRD 14.4-14.5). Runs only in GitHub Actions, inside the Playwright Docker image,
 * against `vite preview` (the built Worker + assets in workerd, local D1) on :8787.
 * Visual baselines: 390x844 and 1280x800, fake clock 10:42 IST on 19 Oct 2026, max diff 0.1%.
 */
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const FAKE_CAMERA = fileURLToPath(new URL('./assets/face.y4m', import.meta.url));

const PORT = 8787;

/**
 * Split-host run (docs/owner-access.md): the same preview Worker with OWNER_HOST set, so the staff and
 * owner hosts are served from their own build folders. `E2E_SPLIT=1` runs only the `split-hosts`
 * project; the default run keeps OWNER_HOST unset (the combined build, as in production today). The
 * ci workflow sets OWNER_HOST=owner.example.test:8787 for that run; the hosts are placeholders (see
 * tests/split). Chromium maps `*.example.test` to loopback; API calls send a Host header.
 */
const SPLIT = process.env.E2E_SPLIT === '1';
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Redmi Note 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

export default defineConfig({
  testDir: './tests',
  ...(SPLIT ? {} : { testIgnore: /split\// }),
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.001, animations: 'disabled', caret: 'hide' } },
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{arg}{ext}',
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }], ['json', { outputFile: 'test-results/results.json' }]]
    : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
  },
  projects: SPLIT
    ? [
        {
          name: 'split-hosts',
          testMatch: /split\/.*\.spec\.ts/,
          use: {
            browserName: 'chromium',
            viewport: { width: 390, height: 844 },
            launchOptions: { args: ['--host-resolver-rules=MAP *.example.test localhost'] },
          },
        },
      ]
    : [
        {
          name: 'staff-android',
          use: {
            browserName: 'chromium',
            viewport: { width: 390, height: 844 },
            deviceScaleFactor: 2,
            isMobile: true,
            hasTouch: true,
            userAgent: ANDROID_UA,
            launchOptions: {
              args: [
                '--use-fake-ui-for-media-stream',
                '--use-fake-device-for-media-stream',
                `--use-file-for-fake-video-capture=${FAKE_CAMERA}`,
              ],
            },
          },
        },
        {
          name: 'staff-ios',
          use: {
            browserName: 'webkit',
            viewport: { width: 390, height: 844 },
            deviceScaleFactor: 2,
            isMobile: true,
            hasTouch: true,
            userAgent: IOS_UA,
          },
        },
        {
          name: 'owner-desktop',
          use: { browserName: 'chromium', viewport: { width: 1280, height: 800 } },
        },
        {
          name: 'owner-phone',
          use: {
            browserName: 'chromium',
            viewport: { width: 390, height: 844 },
            deviceScaleFactor: 2,
            isMobile: true,
            hasTouch: true,
            userAgent: ANDROID_UA,
          },
        },
      ],
  webServer: {
    command: 'pnpm --filter @fs/app exec vite preview --port 8787 --strictPort',
    cwd: '..',
    url: `http://localhost:${PORT}/api/v1/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
