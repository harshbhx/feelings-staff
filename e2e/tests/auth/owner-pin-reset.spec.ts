import { expect, test } from '../../fixtures';

/**
 * Forgotten owner PIN (PRD 4.1.7 "Owner PIN forgotten", docs/owner-access.md Passkeys flow 6), on
 * `owner-desktop` against the real API: a password session cannot skip the old PIN; "Forgot your
 * PIN?" goes through the email-code sign-in and back to Security, the new PIN works, the old one and
 * the other session stop, and the "PIN was changed" email is in the outbox.
 */
test.describe('owner forgotten PIN', () => {
  test.beforeEach(({ page: _page }, info) => {
    test.skip(info.project.name !== 'owner-desktop', 'Owner desktop path');
  });

  test('email code sign-in, new PIN without the old one, other sessions signed out', async ({
    page,
    request,
    reset,
    outbox,
  }) => {
    const s = await reset('basic-salon');
    const headers = { 'X-FS-Client': '0.1.0', Origin: 'http://localhost:8787' };
    const password = (pin: string | null) =>
      request.post('/api/v1/auth/owner/password', {
        headers,
        data: { email: s.owner.email, password: s.owner.password, pin },
      });
    // Another device, signed in with the password and the PIN.
    expect((await password(s.owner.pin)).status()).toBe(200);

    // In the browser: password sign-in first, which never opens the reset.
    await page.goto('/auth/owner?next=%2Fo%2Fsettings%2Fsecurity');
    await page.getByRole('button', { name: 'Use password instead' }).click();
    await page.getByLabel('Email').fill(s.owner.email);
    await page.getByLabel('Password').fill(s.owner.password ?? '');
    await page.getByLabel('Owner PIN').fill(s.owner.pin ?? '');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/o\/settings\/security/);
    await expect(page.getByLabel('Current PIN')).toBeVisible();

    await page.getByRole('button', { name: 'Forgot your PIN?' }).click();
    await page.getByRole('button', { name: 'Sign in with an email code' }).click();
    await expect(page).toHaveURL(/\/auth\/owner\?next=/);
    await page.getByLabel('Email').fill(s.owner.email);
    await page.getByRole('button', { name: 'Send me a sign-in link' }).click();
    let code = '';
    await expect
      .poll(async () => {
        const mail = (await outbox())
          .filter((o) => o.channel === 'email' && o.to === s.owner.email)
          .at(-1);
        const text = (mail?.payload as { text?: string } | undefined)?.text ?? '';
        code = text.match(/\b(\d{6})\b/)?.[1] ?? '';
        return code;
      })
      .toMatch(/^\d{6}$/);
    await page.getByLabel('6-digit code').fill(code);

    // Back on Security, the server says the window is open: no current PIN asked.
    await expect(page).toHaveURL(/\/o\/settings\/security/);
    await expect(page.getByRole('button', { name: 'Set new PIN' })).toBeVisible();
    await expect(page.getByLabel('Current PIN')).toHaveCount(0);
    await page.getByLabel('New PIN', { exact: true }).fill('739164');
    await page.getByLabel('New PIN again').fill('739164');
    await page.getByRole('button', { name: 'Set new PIN' }).click();
    await expect(page.getByText('New PIN saved. Your other devices are signed out.')).toBeVisible();
    await expect(page.getByLabel('Current PIN')).toBeVisible();

    // The other device is signed out; the old PIN no longer signs in, the new one does.
    expect((await request.get('/api/v1/me', { headers })).status()).toBe(401);
    expect((await password(s.owner.pin)).status()).toBe(401);
    expect((await password('739164')).status()).toBe(200);
    await expect
      .poll(async () =>
        (await outbox()).some(
          (o) =>
            o.channel === 'email' &&
            o.to === s.owner.email &&
            ((o.payload as { text?: string } | undefined)?.text ?? '').includes(
              'Your owner PIN was changed',
            ),
        ),
      )
      .toBe(true);
  });
});
