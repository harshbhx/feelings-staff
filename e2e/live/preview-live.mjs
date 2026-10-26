/**
 * Live check of the shared preview (docs/deploy.md, Preview environment). Not part of the suites.
 * Signs in as the demo owner, opens every owner screen and screenshots it, then onboards a throwaway
 * staff phone, checks in far from the salon and inside it, and reads the staff screens.
 * Needs PREVIEW_URL, PREVIEW_OWNER_EMAIL, PREVIEW_OWNER_PASSWORD, PREVIEW_OWNER_PIN. Writes PNGs and
 * results.json to e2e/live-out. Preview data only: never point it at production.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const base = (process.env.PREVIEW_URL ?? '').replace(/\/$/, '');
const { PREVIEW_OWNER_EMAIL: email, PREVIEW_OWNER_PASSWORD: password, PREVIEW_OWNER_PIN: pin } =
  process.env;
if (!base || !email || !password || !pin) throw new Error('missing PREVIEW_* environment');
if (/staff\.feelingsbeautycare\.in/.test(base)) throw new Error('refusing to run on production');
const out = 'live-out';
mkdirSync(out, { recursive: true });
const results = [];
const record = (name, ok, note = '') => {
  results.push({ name, ok, note });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? `  (${note})` : ''}`);
};
async function step(name, fn) {
  try {
    const note = await fn();
    record(name, true, typeof note === 'string' ? note : '');
  } catch (e) {
    record(name, false, String(e?.message ?? e).split('\n')[0].slice(0, 200));
  }
}

const e2eToken = process.env.PREVIEW_E2E_TOKEN ?? '';
async function setClock(nowMs) {
  const r = await fetch(`${base}/api/v1/__test/clock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: new URL(base).origin, 'X-FS-Client': '0.1.0', 'X-E2E-Token': e2eToken },
    body: JSON.stringify({ nowMs }),
  });
  return r.status;
}
const browser = await chromium.launch();
const ownerCtx = await browser.newContext({
  baseURL: base,
  viewport: { width: 1280, height: 900 },
  locale: 'en-IN',
  timezoneId: 'Asia/Kolkata',
});
let n = 0;
async function api(ctx, method, path, data) {
  n += 1;
  const res = await ctx.request.fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      Origin: new URL(base).origin,
      'X-FS-Client': '0.1.0',
      ...(method === 'GET' ? {} : { 'Idempotency-Key': `live-${Date.now()}-${n}` }),
    },
    ...(data === undefined ? {} : { data }),
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  return { status: res.status(), body };
}

await step('health', async () => {
  const r = await api(ownerCtx, 'GET', '/health');
  if (r.status !== 200) throw new Error(`status ${r.status}`);
  return `commit ${r.body.commit}`;
});
await step('owner sign-in (email, password, PIN)', async () => {
  const r = await api(ownerCtx, 'POST', '/auth/owner/password', { email, password, pin });
  if (r.status !== 200) throw new Error(`status ${r.status}`);
  const s = await api(ownerCtx, 'POST', '/auth/step-up', { pin });
  if (s.status !== 200) throw new Error(`step-up ${s.status}`);
});

const screens = [
  ['today', '/o/today'],
  ['actions', '/o/actions'],
  ['roll-call', '/o/roll-call'],
  ['register', '/o/register'],
  ['staff', '/o/staff'],
  ['roster', '/o/roster'],
  ['duties', '/o/duties'],
  ['advances', '/o/advances'],
  ['payroll', '/o/payroll'],
  ['credits', '/o/credits'],
  ['reports', '/o/reports'],
  ['inbox', '/o/inbox'],
  ['more', '/o/more'],
  ['settings', '/o/settings'],
  ['settings-security', '/o/settings/security'],
  ['door-code', '/o/door-code'],
];
const ownerPage = await ownerCtx.newPage();
const consoleErrors = [];
ownerPage.on('pageerror', (e) => consoleErrors.push(String(e).slice(0, 160)));
for (const [name, path] of screens) {
  await step(`owner screen ${name}`, async () => {
    await ownerPage.goto(path, { waitUntil: 'networkidle', timeout: 45_000 });
    await ownerPage.waitForTimeout(800);
    await ownerPage.screenshot({ path: `${out}/owner-${name}.png`, fullPage: true });
    if ((await ownerPage.getByTestId('owner-route-error').count()) > 0) throw new Error('route error shown');
    const url = ownerPage.url();
    if (/signin|auth\/owner/.test(url)) throw new Error(`bounced to ${url}`);
    const body = (await ownerPage.locator('body').innerText()).slice(0, 4000);
    if (/something went wrong|couldn.t load/i.test(body)) throw new Error('error text on page');
  });
}
record('uncaught page errors on owner screens', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

const get = async (name, path, check) =>
  step(`api ${name}`, async () => {
    const r = await api(ownerCtx, 'GET', path);
    if (r.status !== 200) throw new Error(`status ${r.status}`);
    return check?.(r.body);
  });
await get('credits', '/owner/credits', (b) => `${(b.staff ?? []).length} people`);
await get('payroll runs', '/owner/payroll-runs', (b) => `${(b.runs ?? b.items ?? []).length} runs`);
await get('staff list', '/owner/staff', (b) => `${(b.staff ?? b.items ?? b ?? []).length} rows`);
await get('settings', '/owner/settings');
let site;
await step('salon site', async () => {
  const r = await api(ownerCtx, 'GET', '/owner/sites');
  if (r.status !== 200) throw new Error(`status ${r.status}`);
  const list = r.body.sites ?? r.body.items ?? r.body;
  site = list[0];
  if (!site) throw new Error('no site');
  return `lat/lng present: ${site.lat !== undefined || site.latitude !== undefined}`;
});

// ---- A throwaway staff phone -------------------------------------------------------------------
const lat = site?.lat ?? site?.latitude;
const lng = site?.lng ?? site?.longitude ?? site?.lon;
const phoneNo = `98${String(Date.now()).slice(-8)}`;
const staffPin = '739204';
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
let invite;
await step('add a throwaway staff member', async () => {
  const t = await api(ownerCtx, 'GET', '/owner/shift-templates');
  const full = (t.body ?? []).find((x) => x.name === 'Full day') ?? t.body[0];
  const r = await api(ownerCtx, 'POST', '/owner/staff', {
    name: 'Preview Tester',
    phone: `+91${phoneNo}`,
    designation: 'Stylist',
    joinDate: today,
    salaryType: 'monthly',
    salaryAmountPaise: 1_500_000,
    defaultTemplateId: full?.id,
    weekOffDow: null,
    lang: 'en',
    selfieRequired: false,
    adultConfirmed: true,
  });
  if (r.status >= 300) throw new Error(`status ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
  invite = { id: r.body.staff.id, code: r.body.invite.code };
});

if (invite && lat !== undefined) {
  if (e2eToken) {
    // Midday IST, inside the shift window, so the check-in tests the geofence and not the clock.
    const midday = Date.parse(`${today}T12:00:00+05:30`);
    record('fake clock set to 12:00 IST for the check-in test', (await setClock(midday)) === 200);
  }
  const phoneCtx = await browser.newContext({
    baseURL: base,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
    geolocation: { latitude: lat + 0.05, longitude: lng + 0.05, accuracy: 20 },
    permissions: ['geolocation'],
  });
  const page = await phoneCtx.newPage();
  await step('staff joins on a phone and waits for approval', async () => {
    await page.goto(`/join?code=${encodeURIComponent(invite.code)}&allowBrowser=1`);
    await page.getByLabel('Your phone number').fill(phoneNo);
    const codeField = page.getByLabel('Join code');
    if ((await codeField.inputValue()) === '') await codeField.fill(invite.code);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'I understand' }).click();
    const newPin = page.getByRole('textbox', { name: 'New PIN' });
    await newPin.waitFor({ timeout: 20_000 });
    await newPin.fill(staffPin);
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('textbox', { name: 'Your PIN again' }).fill(staffPin);
    await page.getByRole('button', { name: 'Set up this phone' }).click();
    const later = page.getByRole('button', { name: 'Not now' });
    const waiting = page.getByRole('heading', { level: 1, name: 'Waiting for approval' });
    await later.or(waiting).first().waitFor({ timeout: 20_000 });
    if (await later.isVisible()) await later.click();
    await waiting.waitFor();
    await page.screenshot({ path: `${out}/staff-waiting.png` });
  });
  await step('owner approves the phone', async () => {
    let dev;
    for (let i = 0; i < 15 && !dev; i++) {
      const d = await api(ownerCtx, 'GET', `/owner/staff/${invite.id}`);
      dev = d.body?.devices?.find((x) => x.status === 'pending');
      if (!dev) await new Promise((r) => setTimeout(r, 1000));
    }
    if (!dev) throw new Error('no pending device');
    const r = await api(ownerCtx, 'POST', `/owner/devices/${dev.id}/decide`, { decision: 'approve' });
    if (r.status >= 300) throw new Error(`status ${r.status}`);
  });
  await step('staff home shows', async () => {
    await page.getByRole('heading', { level: 1, name: 'Preview' }).or(
      page.getByRole('dialog', { name: 'When you are not at the salon' }),
    ).first().waitFor({ timeout: 40_000 });
    const ok = page.getByRole('button', { name: 'OK, I understand' });
    if (await ok.isVisible().catch(() => false)) await ok.click();
    await page.getByRole('heading', { level: 1, name: 'Preview' }).waitFor({ timeout: 20_000 });
    await page.screenshot({ path: `${out}/staff-home.png`, fullPage: true });
  });

  async function openCheckIn(label) {
    await page.getByRole('button', { name: label, exact: true }).click();
    const sheet = page.getByRole('dialog');
    const allow = sheet.getByRole('button', { name: 'Allow location' });
    for (let i = 0; i < 60; i++) {
      const s = await sheet.locator('[data-punch-step]').getAttribute('data-punch-step').catch(() => null);
      if (s === 'permission') await allow.click().catch(() => {});
      else if (s && /^(pin|problem|result|sent|camera|scanning|confirm|queued)$/.test(s)) return s;
      await page.waitForTimeout(500);
    }
    throw new Error('check-in sheet never settled');
  }
  await step('geofence: check-in 7 km away is not a plain success', async () => {
    const s = await openCheckIn('Check in');
    await page.screenshot({ path: `${out}/staff-checkin-far.png` });
    if (s === 'result') throw new Error('far check-in succeeded outright');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    return `sheet step: ${s}`;
  });
  await step('geofence: check-in inside the salon succeeds', async () => {
    await phoneCtx.setGeolocation({ latitude: lat, longitude: lng, accuracy: 15 });
    if (!(await page.getByRole('button', { name: 'Check in', exact: true }).isVisible())) {
      await page.reload({ waitUntil: 'networkidle' });
    }
    const s = await openCheckIn('Check in');
    const sheet = page.getByRole('dialog');
    if (s === 'problem') {
      await page.screenshot({ path: `${out}/staff-checkin-problem.png` });
      throw new Error('problem step inside the salon');
    }
    if (s === 'pin') {
      await sheet.getByRole('textbox', { name: 'Enter your PIN' }).fill(staffPin);
      await sheet.getByRole('button', { name: 'Check in', exact: true }).click({ timeout: 2000 }).catch(() => {});
    }
    await sheet.locator('[data-punch-step="result"]').waitFor({ timeout: 30_000 });
    await page.screenshot({ path: `${out}/staff-checkin-ok.png` });
  });
  await step('staff Today after check-in', async () => {
    await page.waitForTimeout(3000);
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.screenshot({ path: `${out}/staff-today.png`, fullPage: true });
  });
  for (const [name, path] of [['me', '/me'], ['inbox', '/inbox']]) {
    await step(`staff screen ${name}`, async () => {
      await page.goto(path, { waitUntil: 'networkidle' });
      await page.screenshot({ path: `${out}/staff-${name}.png`, fullPage: true });
      if (/signin/.test(page.url())) throw new Error('bounced to sign-in');
    });
  }
  await step('owner sees the check-in on Today', async () => {
    await ownerPage.goto('/o/today', { waitUntil: 'networkidle' });
    await ownerPage.waitForTimeout(800);
    const txt = await ownerPage.locator('body').innerText();
    await ownerPage.screenshot({ path: `${out}/owner-today-after-checkin.png`, fullPage: true });
    if (!/Preview Tester/.test(txt)) throw new Error('Preview Tester not on Today');
  });
  await phoneCtx.close();
  if (e2eToken) record('fake clock cleared', (await setClock(null)) === 200);
} else {
  record('staff phone flow', false, 'no salon coordinates or invite, skipped');
}

// A seeded person's time credits and payslip through the owner view.
await step('owner opens a seeded person (credits + payslips)', async () => {
  const list = await api(ownerCtx, 'GET', '/owner/staff');
  const rows = list.body.staff ?? list.body.items ?? list.body;
  const p = rows.find((r) => /Priya/.test(r.name)) ?? rows[0];
  await ownerPage.goto(`/o/staff/${p.id}`, { waitUntil: 'networkidle' });
  await ownerPage.waitForTimeout(800);
  await ownerPage.screenshot({ path: `${out}/owner-person.png`, fullPage: true });
});

await browser.close();
writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(0);
