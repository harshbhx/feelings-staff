/**
 * Shared steps for the cross-flow E2E suites: an owner session driven through the API (password,
 * PIN, step-up, idempotency keys) and a real staff phone driven through the join screens. The staff
 * phone keeps its own cookie in the page, so staff API calls go through `staffApi(page)`.
 */
import { type APIRequestContext, errors, type Page } from '@playwright/test';
import { expect } from '../../fixtures';

const HEADERS = { 'X-FS-Client': '0.1.0', Origin: 'http://localhost:8787' };
const BASE = '/api/v1';

export interface OwnerCreds {
  email: string;
  password: string | null;
  pin: string | null;
}

export interface ApiResult<T> {
  status: number;
  body: T;
}

let keySeq = 0;

export type OwnerApi = Awaited<ReturnType<typeof ownerSession>>;

/** Sign the owner in (password + PIN) and step up. Call again after the server clock jumps. */
export async function ownerSession(request: APIRequestContext, creds: OwnerCreds) {
  async function call<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    data?: unknown,
  ): Promise<ApiResult<T>> {
    keySeq += 1;
    const res = await request.fetch(`${BASE}${path}`, {
      method,
      headers: {
        ...HEADERS,
        ...(method === 'GET' ? {} : { 'Idempotency-Key': `xf-${Date.now()}-${keySeq}` }),
      },
      ...(data === undefined ? {} : { data }),
    });
    const text = await res.text();
    return { status: res.status(), body: (text ? JSON.parse(text) : undefined) as T };
  }
  async function ok<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    data?: unknown,
  ): Promise<T> {
    const r = await call<T>(method, path, data);
    expect(r.status, `${method} ${path}: ${JSON.stringify(r.body)}`).toBeLessThan(300);
    return r.body;
  }
  expect(creds.password && creds.pin, 'the scenario has owner credentials').toBeTruthy();
  await ok('POST', '/auth/owner/password', creds);
  await ok('POST', '/auth/step-up', { pin: creds.pin });
  return { call, ok };
}

/** Add a person, return the id and join code. */
export async function addStaff(
  owner: OwnerApi,
  p: { name: string; phone: string; joinDate: string },
): Promise<{ id: string; code: string }> {
  const templates = await owner.ok<{ id: string; name: string }[]>('GET', '/owner/shift-templates');
  const full = templates.find((t) => t.name === 'Full day') ?? templates[0];
  expect(full, 'a shift template').toBeTruthy();
  const made = await owner.ok<{ staff: { id: string }; invite: { code: string } }>(
    'POST',
    '/owner/staff',
    {
      name: p.name,
      phone: `+91${p.phone}`,
      designation: 'Stylist',
      joinDate: p.joinDate,
      salaryType: 'monthly',
      salaryAmountPaise: 1_500_000,
      defaultTemplateId: full?.id,
      weekOffDow: null,
      lang: 'en',
      selfieRequired: false,
      adultConfirmed: true,
    },
  );
  return { id: made.staff.id, code: made.invite.code };
}

/** The join screens: phone, code, notice, PIN twice, notifications later, then waiting. */
export async function joinOnPhone(page: Page, phone: string, code: string, pin: string) {
  await page.goto(`/join?code=${encodeURIComponent(code)}&allowBrowser=1`);
  await page.getByLabel('Your phone number').fill(phone);
  const codeField = page.getByLabel('Join code');
  if ((await codeField.inputValue()) === '') await codeField.fill(code);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'I understand' }).click();
  await page.getByRole('textbox', { name: 'New PIN' }).fill(pin);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('textbox', { name: 'Your PIN again' }).fill(pin);
  await page.getByRole('button', { name: 'Set up this phone' }).click();
  const later = page.getByRole('button', { name: 'Not now' });
  const waiting = page.getByRole('heading', { level: 1, name: 'Waiting for approval' });
  await expect(later.or(waiting)).toBeVisible({ timeout: 20_000 });
  if (await later.isVisible()) await later.click();
  await expect(waiting).toBeVisible();
}

/** The owner approves the pending phone of one person (S-01). */
export async function approvePhone(owner: OwnerApi, staffId: string) {
  await expect
    .poll(
      async () => {
        const d = await owner.ok<{ devices: { id: string; status: string }[] }>(
          'GET',
          `/owner/staff/${staffId}`,
        );
        return d.devices.find((x) => x.status === 'pending')?.id ?? null;
      },
      { timeout: 15_000 },
    )
    .not.toBeNull();
  const d = await owner.ok<{ devices: { id: string; status: string }[] }>(
    'GET',
    `/owner/staff/${staffId}`,
  );
  const pending = d.devices.find((x) => x.status === 'pending');
  await owner.ok('POST', `/owner/devices/${pending?.id}/decide`, { decision: 'approve' });
}

/** Join, get approved and land on the staff home. */
export async function onboardPhone(
  page: Page,
  owner: OwnerApi,
  p: { name: string; phone: string; pin: string; joinDate: string },
): Promise<{ id: string }> {
  const staff = await addStaff(owner, p);
  await joinOnPhone(page, p.phone, staff.code, p.pin);
  await approvePhone(owner, staff.id);
  const home = page.getByRole('heading', {
    level: 1,
    name: p.name.split(' ')[0] ?? p.name,
  });
  // The first Today asks for the presence notice once (PRD 4.18.1): say OK, then the home shows.
  const notice = page.getByRole('button', { name: 'OK, I understand' });
  await expect(home.or(notice)).toBeVisible({ timeout: 30_000 });
  // The home heading can show before the presence answer and the lazy notice sheet arrive: let
  // both settle, then look for the notice again.
  await page.waitForLoadState('networkidle');
  if (await notice.isVisible()) await notice.click();
  await expect(home).toBeVisible();
  return { id: staff.id };
}

/** The staff phone calls the API with its own session. */
export function staffApi(page: Page) {
  return async function call<T>(
    method: 'GET' | 'POST',
    path: string,
    data?: unknown,
  ): Promise<ApiResult<T>> {
    return page.evaluate(
      async ({ method, path, data }) => {
        const res = await fetch(`/api/v1${path}`, {
          method,
          headers: {
            'X-FS-Client': '0.1.0',
            ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          ...(data === undefined ? {} : { body: JSON.stringify(data) }),
        });
        const text = await res.text();
        return { status: res.status, body: text ? JSON.parse(text) : undefined };
      },
      { method, path, data },
    ) as Promise<ApiResult<T>>;
  };
}

/** Tap Check in or Check out on the staff home, answer the sheet, and wait for the result. */
export async function punch(page: Page, kind: 'in' | 'out', pin: string) {
  const label = kind === 'in' ? 'Check in' : 'Check out';
  await page.getByRole('button', { name: label, exact: true }).click();
  const sheet = page.getByRole('dialog');
  const anyway = sheet.getByRole('button', { name: 'Check in anyway' });
  const pinPad = sheet.getByRole('textbox', { name: 'Enter your PIN' });
  await expect(anyway.or(pinPad)).toBeVisible({ timeout: 30_000 });
  if (await anyway.isVisible()) await anyway.click();
  await pinPad.fill(pin);
  // The pad may send by itself once the PIN is complete; tap the button only if it is still there.
  await sheet
    .getByRole('button', { name: label, exact: true })
    .click({ timeout: 2_000 })
    .catch((err: unknown) => {
      if (!(err instanceof errors.TimeoutError)) throw err;
    });
  const result = sheet.locator('[data-punch-step="result"]');
  const problem = sheet.locator('[data-punch-step="problem"]');
  await expect(result.or(problem)).toBeVisible({ timeout: 30_000 });
  if (await problem.isVisible()) {
    throw new Error(`${label} failed: ${await problem.getAttribute('data-punch-reason')}`);
  }
  // The success view has no button: it closes by itself. The other end states have "Done".
  const done = sheet.getByRole('button', { name: 'Done' });
  if (await done.isVisible()) await done.click();
  else
    await expect(sheet)
      .toBeHidden({ timeout: 20_000 })
      .catch(() => page.keyboard.press('Escape'));
  await expect(sheet).toBeHidden({ timeout: 10_000 });
}

/** IST wall time on a date as epoch ms. */
export function ist(date: string, hhmm: string): number {
  return Date.parse(`${date}T${hhmm}:00+05:30`);
}
