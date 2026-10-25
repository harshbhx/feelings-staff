/**
 * iPhone review shots (iOS redesign). Not a test suite: `shots/ios.shots.ts` opens each key screen
 * in mock mode and saves a PNG per screen, at two iPhone sizes in light and dark, for the PR review
 * and the contact sheets. Runs only in GitHub Actions (`.github/workflows/ios-shots.yml`), against
 * the same `vite preview` server as the E2E run. Nothing here is compared against a baseline.
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = 8787;
const IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

/** iPhone 15/16 (393 x 852) and iPhone SE 3 (375 x 667), each in light and dark. */
const SIZES = [
  { id: '393', viewport: { width: 393, height: 852 } },
  { id: '375', viewport: { width: 375, height: 667 } },
] as const;
const SCHEMES = ['light', 'dark'] as const;

export default defineConfig({
  testDir: './shots',
  testMatch: /.*\.shots\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
  },
  projects: [
    ...SIZES.flatMap((size) =>
      SCHEMES.map((colorScheme) => ({
        name: `i${size.id}-${colorScheme}`,
        use: {
          ...devices['iPhone 15'],
          browserName: 'webkit' as const,
          viewport: size.viewport,
          deviceScaleFactor: 3,
          isMobile: true,
          hasTouch: true,
          userAgent: IOS_UA,
          colorScheme,
        },
      })),
    ),
    /* The shared kit is not an iPhone thing: a tablet (Safari engine) and a desktop (Chromium) too. */
    {
      name: 'tablet-820-light',
      use: {
        ...devices['iPad (gen 7)'],
        browserName: 'webkit' as const,
        viewport: { width: 820, height: 1180 },
        deviceScaleFactor: 2,
        colorScheme: 'light' as const,
      },
    },
    {
      name: 'desktop-1280-light',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        colorScheme: 'light' as const,
      },
    },
    {
      name: 'desktop-1280-dark',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        colorScheme: 'dark' as const,
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
