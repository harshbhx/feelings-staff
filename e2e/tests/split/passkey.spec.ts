/**
 * Owner passkeys on the owner host (docs/owner-access.md, slice 4). Runs only in the `split-hosts`
 * project (E2E_SPLIT=1, OWNER_HOST=owner.example.test:8787). Chromium's virtual authenticator (the
 * CDP WebAuthn domain) stands in for the fingerprint; the preview owner host is plain http, so the
 * project treats that origin as secure (playwright.config.ts). Screenshots of the three screens are
 * attached to the report.
 */
import type { CDPSession, Page } from '@playwright/test';
import { expect, test } from '../../fixtures';

const OWNER = 'owner.example.test:8787';

async function virtualAuthenticator(page: Page): Promise<CDPSession> {
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

async function shot(page: Page, name: string): Promise<void> {
  await test.info().attach(name, { body: await page.screenshot(), contentType: 'image/png' });
}

test.describe('SPLIT-3 owner passkeys', () => {
  // fixme: in the CI Playwright image the owner host (plain http) is not a secure context although the
  // project passes --unsafely-treat-insecure-origin-as-secure, so window.PublicKeyCredential is missing
  // and the enrol screen shows "This browser can't use a passkey" (runs 39651804725, 39675712157).
  // The server side is covered by the Workers passkey tests. Next: serve the owner host on a
  // *.localhost name (a secure context by default) or over https in the split-hosts run.
  test.fixme('SPLIT-3.1 first device after the email code, then sign-in with the fingerprint', async ({
    page,
    reset,
    outbox,
  }) => {
    const s = await reset('basic-salon');
    await virtualAuthenticator(page);

    await page.goto(`http://${OWNER}/auth/owner`);
    await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Use your fingerprint' })).toBeVisible();
    await shot(page, 'owner-sign-in-first-device');
    await page.getByRole('button', { name: 'Email me a code' }).click();

    await expect(page).toHaveURL(/\/auth\/owner\/email/);
    await page.getByLabel('Email').fill(s.owner.email);
    await page.getByRole('button', { name: 'Send me a sign-in link' }).click();
    let code = '';
    await expect
      .poll(async () => {
        const mail = (await outbox()).find((o) => o.channel === 'email' && o.to === s.owner.email);
        const text = (mail?.payload as { text?: string } | undefined)?.text ?? '';
        code = text.match(/\b(\d{6})\b/)?.[1] ?? '';
        return code;
      })
      .toMatch(/^\d{6}$/);
    await page.getByLabel('6-digit code').fill(code);

    await expect(page).toHaveURL(/\/auth\/owner\/enrol/);
    await expect(page.getByRole('heading', { name: 'Make this phone your key' })).toBeVisible();
    await shot(page, 'owner-enrol');
    await page.getByRole('button', { name: 'Make this phone your key' }).click();
    await expect(page.getByRole('heading', { name: 'This phone is your key' })).toBeVisible();
    await expect(page.getByLabel('Name of this phone')).toHaveValue(/'s computer$/);
    await shot(page, 'owner-enrol-done');
    await page.getByLabel('Name of this phone').fill('Front desk laptop');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(/\/o\/today/);

    // Next visit: no email code any more; the fingerprint signs in.
    await page.context().clearCookies();
    await page.goto(`http://${OWNER}/auth/owner`);
    await expect(page.getByRole('button', { name: 'Use your fingerprint' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Email me a code' })).toHaveCount(0);
    await shot(page, 'owner-sign-in');
    await page.getByRole('button', { name: 'Use your fingerprint' }).click();
    await expect(page).toHaveURL(/\/o\/today/);
  });
});
