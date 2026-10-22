/**
 * Helpers for the owner-host specs in the `split-hosts` project (docs/owner-access.md): Chromium's
 * virtual authenticator (the CDP WebAuthn domain) in place of a fingerprint, report screenshots, and
 * the first device enrolled through the email code. Not a spec file itself.
 */
import {
  type Browser,
  type BrowserContext,
  type CDPSession,
  expect,
  type Page,
  test,
} from '@playwright/test';

/**
 * The owner host of the split run. A `*.localhost` name: Chromium resolves it to loopback and treats it
 * as a secure context over plain http, which WebAuthn needs (an `--unsafely-treat-insecure-origin-as-
 * secure` flag for another name did not take effect in the CI image).
 */
export const OWNER = 'owner.localhost:8787';

/** A platform authenticator with user verification that says yes without a prompt. */
export async function virtualAuthenticator(page: Page): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return cdp;
}

/** Attach a screenshot to the report (no baseline: the split run has none). */
export async function shot(page: Page, name: string): Promise<void> {
  await test.info().attach(name, { body: await page.screenshot(), contentType: 'image/png' });
}

type Outbox = () => Promise<{ channel: string; to: string; payload: unknown }[]>;

/** The email code, then "Make this phone your key": the page ends signed in on /o/today. */
export async function enrolFirstDevice(page: Page, email: string, outbox: Outbox): Promise<void> {
  await page.goto(`http://${OWNER}/auth/owner`);
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send me a sign-in link' }).click();
  let code = '';
  await expect
    .poll(async () => {
      const mail = (await outbox()).find((o) => o.channel === 'email' && o.to === email);
      const text = (mail?.payload as { text?: string } | undefined)?.text ?? '';
      code = text.match(/\b(\d{6})\b/)?.[1] ?? '';
      return code;
    })
    .toMatch(/^\d{6}$/);
  await page.getByLabel('6-digit code').fill(code);
  await page.getByRole('button', { name: 'Make this phone your key' }).click();
  await expect(page.getByRole('heading', { name: 'This phone is your key' })).toBeVisible();
  await page.getByLabel('Name of this phone').fill('Front desk phone');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/o\/today/);
}

/** The new device: a separate browser (no cookies, its own authenticator) on "Add this device". */
export async function newDevice(
  browser: Browser,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await virtualAuthenticator(page);
  await page.goto(`http://${OWNER}/auth/owner`);
  await page.getByRole('button', { name: 'Add this device' }).click();
  await expect(page).toHaveURL(/\/auth\/owner\/add/);
  return { context, page };
}

/** The code the new device shows ("482 913" on screen). */
export async function codeOn(page: Page): Promise<string> {
  const card = page.getByTestId('device-code');
  await expect(card).toContainText(/\d{3} \d{3}/);
  const m = (await card.textContent())?.match(/(\d{3}) (\d{3})/);
  if (!m) throw new Error('no code on the new device');
  return `${m[1]} ${m[2]}`;
}
