import { expect, test } from '../../fixtures';

/**
 * E2E-21 (PRD 14.4, O-01): owner sign-in with the 6-digit code from the preview outbox, the
 * password fallback, and the owner PIN step-up. Runs on `owner-desktop`.
 */
test.describe('E2E-21 owner sign-in', () => {
  test.beforeEach(({ page: _page }, info) => {
    test.skip(info.project.name !== 'owner-desktop', 'Owner desktop path');
  });

  test('E2E-21 email code: the link and code arrive in the outbox and sign the owner in', async ({
    page,
    reset,
    outbox,
  }) => {
    const s = await reset('basic-salon');
    await page.goto('/auth/owner');
    await expect(page.getByRole('heading', { name: 'Owner sign-in' })).toBeVisible();
    await page.getByLabel('Email').fill(s.owner.email);
    await page.getByRole('button', { name: 'Send me a sign-in link' }).click();
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
    let code = '';
    await expect
      .poll(async () => {
        const mail = (await outbox()).find((o) => o.channel === 'email' && o.to === s.owner.email);
        const text = (mail?.payload as { text?: string } | undefined)?.text ?? '';
        code = text.match(/\b(\d{6})\b/)?.[1] ?? '';
        return code;
      })
      .toMatch(/^\d{6}$/);
    // The sixth digit signs in by itself (the button only shows "Signing in…").
    await page.getByLabel('6-digit code').fill(code);
    await expect(page).toHaveURL(/\/o\//);
  });

  test('E2E-21 a wrong code is refused', async ({ page, reset }) => {
    const s = await reset('basic-salon');
    await page.goto('/auth/owner');
    await page.getByLabel('Email').fill(s.owner.email);
    await page.getByRole('button', { name: 'Send me a sign-in link' }).click();
    await page.getByLabel('6-digit code').fill('000000');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/auth\/owner/);
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  });

  test('E2E-21 password fallback with the owner PIN signs the owner in', async ({
    page,
    reset,
  }) => {
    const s = await reset('basic-salon');
    await page.goto('/auth/owner');
    await page.getByRole('button', { name: 'Use password instead' }).click();
    await page.getByLabel('Email').fill(s.owner.email);
    await page.getByLabel('Password').fill(s.owner.password ?? '');
    await page.getByLabel('Owner PIN').fill(s.owner.pin ?? '');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/o\//);
  });

  test('E2E-21 step-up: a sensitive action is refused until the owner PIN is entered', async ({
    request,
    reset,
  }) => {
    const s = await reset('basic-salon');
    const headers = { 'X-FS-Client': '0.1.0', Origin: 'http://localhost:8787' };
    const login = await request.post('/api/v1/auth/owner/password', {
      headers,
      data: { email: s.owner.email, password: s.owner.password, pin: s.owner.pin },
    });
    expect(login.status()).toBe(200);
    const denied = await request.post('/api/v1/owner/door-devices', {
      headers,
      data: { label: 'Tablet' },
    });
    expect(denied.status()).toBe(403);
    const up = await request.post('/api/v1/auth/step-up', { headers, data: { pin: s.owner.pin } });
    expect(up.status()).toBe(200);
    const ok = await request.post('/api/v1/owner/door-devices', {
      headers,
      data: { label: 'Tablet' },
    });
    expect(ok.status()).toBe(201);
  });
});
