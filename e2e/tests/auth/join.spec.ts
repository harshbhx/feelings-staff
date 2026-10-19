import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from '../../fixtures';

/**
 * E2E-02 and E2E-03 (PRD 14.4, S-01): the owner adds a person, the person joins from the phone
 * with the join code, sets a PIN, and the owner approves the phone. Runs against the real API.
 * E2E-02 opens the join screen on Android Chrome; E2E-03 is the same on WebKit (iPhone) with the
 * code typed by hand. The staff app needs the installed app, so the tests pass `?allowBrowser=1`.
 */
const HEADERS = {
  'X-FS-Client': '0.1.0',
  Origin: 'http://localhost:8787',
};

interface Owner {
  email: string;
  password: string | null;
  pin: string | null;
}

async function ownerApi(request: APIRequestContext, owner: Owner) {
  const login = await request.post('/api/v1/auth/owner/password', {
    headers: HEADERS,
    data: { email: owner.email, password: owner.password, pin: owner.pin },
  });
  expect(login.status(), await login.text()).toBe(200);
  const up = await request.post('/api/v1/auth/step-up', {
    headers: HEADERS,
    data: { pin: owner.pin },
  });
  expect(up.status(), await up.text()).toBe(200);
  return {
    get: (path: string) => request.get(`/api/v1${path}`, { headers: HEADERS }),
    post: (path: string, data: unknown) =>
      request.post(`/api/v1${path}`, { headers: HEADERS, data }),
  };
}

async function addStaff(api: Awaited<ReturnType<typeof ownerApi>>, phoneDigits: string) {
  const templates = await (await api.get('/owner/shift-templates')).json();
  const full = (templates as { id: string; name: string }[]).find((t) => t.name === 'Full day');
  const res = await api.post('/owner/staff', {
    name: 'Kavya Joshi',
    phone: `+91${phoneDigits}`,
    designation: 'Stylist',
    joinDate: '2026-10-01',
    salaryType: 'monthly',
    salaryAmountPaise: 1500000,
    defaultTemplateId: full?.id,
    weekOffDow: 2,
    lang: 'en',
    selfieRequired: false,
    adultConfirmed: true,
  });
  expect(res.status(), await res.text()).toBe(201);
  const body = (await res.json()) as { staff: { id: string }; invite: { code: string } };
  return { id: body.staff.id, code: body.invite.code };
}

async function joinThroughScreens(page: Page, phoneDigits: string, code: string, pin: string) {
  await page.goto('/join?allowBrowser=1');
  await expect(page.getByRole('heading', { name: 'Join your team' })).toBeVisible();
  await page.getByLabel('Your phone number').fill(phoneDigits);
  await page.getByLabel('Join code').fill(code);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'I understand' }).click();
  await page.getByLabel('New PIN').fill(pin);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Your PIN again').fill(pin);
  await page.getByRole('button', { name: 'Set up this phone' }).click();
  const later = page.getByRole('button', { name: 'Not now' });
  if (await later.isVisible({ timeout: 5000 }).catch(() => false)) await later.click();
  await expect(page.getByRole('heading', { name: 'Waiting for approval' })).toBeVisible();
}

async function approvePending(
  api: Awaited<ReturnType<typeof ownerApi>>,
  userId: string,
): Promise<void> {
  const list = await (await api.get('/owner/actions?type=new_device')).json();
  const item = (list as { items: { user: { id: string }; device: { id: string } }[] }).items.find(
    (i) => i.user.id === userId,
  );
  expect(item, 'the owner sees the new phone in Needs action').toBeTruthy();
  const res = await api.post(`/owner/devices/${item?.device.id}/decide`, { decision: 'approve' });
  expect(res.status(), await res.text()).toBe(200);
}

test.describe('E2E-02 owner adds staff, staff joins, owner approves the phone', () => {
  test('E2E-02 join on Android with the code from the invite', async ({
    page,
    request,
    reset,
  }, info) => {
    test.skip(info.project.name !== 'staff-android', 'Android Chrome path');
    const s = await reset('basic-salon');
    const api = await ownerApi(request, s.owner);
    const staff = await addStaff(api, '9824055501');
    await joinThroughScreens(page, '9824055501', staff.code, '2580');
    await approvePending(api, staff.id);
    await page.getByRole('button', { name: 'Check again' }).click();
    await expect(page.getByRole('heading', { name: 'Waiting for approval' })).toBeHidden({
      timeout: 20_000,
    });
  });
});

test.describe('E2E-03 WebKit join with the typed code', () => {
  test('E2E-03 an iPhone types the join code, sets a PIN and waits for approval', async ({
    page,
    request,
    reset,
  }, info) => {
    test.skip(info.project.name !== 'staff-ios', 'WebKit path');
    const s = await reset('basic-salon');
    const api = await ownerApi(request, s.owner);
    const staff = await addStaff(api, '9824055502');
    await joinThroughScreens(page, '9824055502', staff.code, '2580');
    await expect(page.getByRole('heading', { name: 'Waiting for approval' })).toBeVisible();
    await approvePending(api, staff.id);
    await page.getByRole('button', { name: 'Check again' }).click();
    await expect(page.getByRole('heading', { name: 'Waiting for approval' })).toBeHidden({
      timeout: 20_000,
    });
  });
});
