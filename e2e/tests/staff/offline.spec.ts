/**
 * Offline queue and update flow end to end (PRD 4.3.6, 11.5, 11.7; E2E-11, E2E-20; AC S-09).
 * Chromium (staff-android) only: it needs service worker control of the page.
 */
import type { APIRequestContext, Page, TestInfo } from '@playwright/test';
import { expect, test } from '../../fixtures';

interface FsPwaHooks {
  state(): { needRefresh: boolean; canPromptNow: boolean; upgradeRequired: boolean };
  queue(): { items: { idempotencyKey: string }[] };
  applyUpdate(): Promise<void>;
  removeQueued(idempotencyKey: string): Promise<void>;
}

declare global {
  interface Window {
    /** Exposed by src/pwa/register.ts on localhost only. */
    __fsPwa?: FsPwaHooks;
  }
}

const APP = '/?mock=1&allowBrowser=1';
const QUEUED_KEY = 'e2e-queued-punch-0001';

function onlyAndroid(info: TestInfo): void {
  test.skip(info.project.name !== 'staff-android', 'Service worker flows run on staff-android');
}

/** Write a queued punch into IndexedDB `feelings` / `pendingPunches` (WP-3's schema). */
async function seedQueuedPunch(page: Page, idempotencyKey: string): Promise<void> {
  await page.evaluate(async (key) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('feelings', 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        d.createObjectStore('device');
        d.createObjectStore('timeAnchor');
        d.createObjectStore('offlineNonces', { keyPath: 'nonce' }).createIndex(
          'byExpiresAt',
          'expiresAt',
        );
        d.createObjectStore('pendingPunches', { keyPath: 'idempotencyKey' }).createIndex(
          'byCreatedAt',
          'createdAt',
        );
        d.createObjectStore('prefs');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('pendingPunches', 'readwrite');
      // Marked failed (as after "device revoked"), so no flush sends it during the test.
      tx.objectStore('pendingPunches').put({
        idempotencyKey: key,
        request: { kind: 'in', idempotencyKey: key, pin: null },
        selfie: null,
        attempts: 1,
        lastError: { status: 403, code: 'DEVICE_NOT_APPROVED', message: '' },
        failed: true,
        createdAt: Date.now(),
        nextAttemptAt: 0,
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, idempotencyKey);
}

const API_HEADERS = { 'X-FS-Client': '0.1.0', Origin: 'http://localhost:8787' };
const STAFF_PIN = '4826';
const STAFF_PHONE = '9824099123';

/** Today's date in IST at `hh:mm` IST, as epoch ms. */
function todayAtIst(hhmm: string): number {
  const date = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  return Date.parse(`${date}T${hhmm}:00+05:30`);
}

function istDateOf(ms: number): string {
  return new Date(ms + 5.5 * 3_600_000).toISOString().slice(0, 10);
}

/** The owner, signed in through the API with password + PIN and stepped up (PRD 4.1.7). */
async function signInOwner(
  request: APIRequestContext,
  creds: { email: string; password: string | null; pin: string | null },
) {
  const call = async (method: 'GET' | 'POST', path: string, data?: unknown, extra = {}) => {
    const res = await request.fetch(`/api/v1${path}`, {
      method,
      headers: { ...API_HEADERS, ...extra },
      ...(data === undefined ? {} : { data }),
    });
    expect(res.status(), `${method} ${path}: ${await res.text()}`).toBeLessThan(300);
    return res.json();
  };
  expect(creds.password && creds.pin, 'the scenario has owner credentials').toBeTruthy();
  await call('POST', '/auth/owner/password', creds);
  await call('POST', '/auth/step-up', { pin: creds.pin });
  return {
    async addStaff(now: number): Promise<{ id: string; code: string }> {
      const templates = (await call('GET', '/owner/shift-templates')) as {
        id: string;
        name: string;
      }[];
      const fullDay = templates.find((t) => t.name === 'Full day') ?? templates[0];
      expect(fullDay, 'a shift template').toBeTruthy();
      const created = (await call(
        'POST',
        '/owner/staff',
        {
          name: 'Riya Patel',
          phone: STAFF_PHONE,
          designation: 'Stylist',
          joinDate: istDateOf(now - 7 * 86_400_000),
          salaryType: 'monthly',
          salaryAmountPaise: 1_500_000,
          defaultTemplateId: fullDay?.id,
          weekOffDow: null,
          lang: 'en',
          selfieRequired: false,
          adultConfirmed: true,
        },
        { 'Idempotency-Key': `e2e-11-${now}` },
      )) as { staff: { id: string }; invite: { code: string } };
      return { id: created.staff.id, code: created.invite.code };
    },
    async approvePendingDevice(staffId: string): Promise<void> {
      await expect
        .poll(
          async () => {
            const detail = (await call('GET', `/owner/staff/${staffId}`)) as {
              devices: { id: string; status: string }[];
            };
            return detail.devices.find((d) => d.status === 'pending')?.id ?? null;
          },
          { timeout: 15_000 },
        )
        .not.toBeNull();
      const detail = (await call('GET', `/owner/staff/${staffId}`)) as {
        devices: { id: string; status: string }[];
      };
      const pending = detail.devices.find((d) => d.status === 'pending');
      await call('POST', `/owner/devices/${pending?.id}/decide`, { decision: 'approve' });
    },
  };
}

/** The kit's PIN pad: the keys are visual only; the real control is a textbox named by its label. */
async function enterPin(scope: Pick<Page, 'getByRole'>, label: string, pin: string): Promise<void> {
  await scope.getByRole('textbox', { name: label }).fill(pin);
}

/** WP-3's join flow: phone and code, notice, PIN twice, notifications later, then waiting. */
async function joinOnThisPhone(page: Page, code: string): Promise<void> {
  await page.goto(`/join?code=${encodeURIComponent(code)}&allowBrowser=1`);
  await page.getByLabel('Your phone number').fill(STAFF_PHONE);
  const codeField = page.getByLabel('Join code');
  if ((await codeField.inputValue()) === '') await codeField.fill(code);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'I understand' }).click();
  await enterPin(page, 'New PIN', STAFF_PIN);
  await page.getByRole('button', { name: 'Next' }).click();
  await enterPin(page, 'Your PIN again', STAFF_PIN);
  await page.getByRole('button', { name: 'Set up this phone' }).click();
  const later = page.getByRole('button', { name: 'Not now' });
  const waiting = page.getByRole('heading', { level: 1, name: 'Waiting for approval' });
  await expect(later.or(waiting)).toBeVisible({ timeout: 20_000 });
  if (await later.isVisible()) await later.click();
  await expect(waiting).toBeVisible();
}

/** IndexedDB `feelings` holds an offline nonce, a signed time and the PIN-sealing key. */
function offlineReady(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('feelings');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const count = (store: string) =>
      new Promise<number>((resolve, reject) => {
        const req = db.transaction(store).objectStore(store).count();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    const [nonces, anchors, prefs] = await Promise.all([
      count('offlineNonces'),
      count('timeAnchor'),
      count('prefs'),
    ]);
    db.close();
    return nonces > 0 && anchors > 0 && prefs > 0;
  });
}

/** What the offline store holds, for a failure message (no secrets: counts and key shape only). */
function storeSummary(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('feelings');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const all = (store: string) =>
      new Promise<unknown[]>((resolve, reject) => {
        const req = db.transaction(store).objectStore(store).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    const [prefs, nonces, anchors, queued] = await Promise.all([
      all('prefs'),
      all('offlineNonces'),
      all('timeAnchor'),
      all('pendingPunches'),
    ]);
    db.close();
    const shape = (v: unknown) =>
      v && typeof v === 'object' ? Object.keys(v as object).join(',') : typeof v;
    return JSON.stringify({
      online: navigator.onLine,
      prefs: prefs.map(shape),
      nonces: nonces.map(shape),
      anchors: anchors.map(shape),
      queued: queued.length,
    });
  });
}

/** Everything in `pendingPunches`, as text, to look for a plaintext PIN. */
function queuedText(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('feelings');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const all = await new Promise<unknown[]>((resolve, reject) => {
      const req = db.transaction('pendingPunches').objectStore('pendingPunches').getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return JSON.stringify(all, (_k, v: unknown) => (v instanceof Blob ? '[blob]' : v));
  });
}

test.describe('offline', () => {
  test('E2E-20 the update prompt waits while a punch is queued', async ({ page }, testInfo) => {
    onlyAndroid(testInfo);
    await page.goto(APP);
    const wired = await page
      .waitForFunction(() => window.__fsPwa !== undefined, null, { timeout: 10_000 })
      .then(
        () => true,
        () => false,
      );
    expect(wired, 'main.tsx starts the service worker and the update flow').toBe(true);

    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await seedQueuedPunch(page, QUEUED_KEY);
    await page.reload();
    await page.waitForFunction(() => window.__fsPwa?.queue().items.length === 1);

    // A new version appears: a new script URL for the same scope always installs a new worker.
    await page.evaluate(() => navigator.serviceWorker.register('/sw.js?e2e=next', { scope: '/' }));
    await page.waitForFunction(() => window.__fsPwa?.state().needRefresh === true);
    expect(await page.evaluate(() => window.__fsPwa?.state())).toMatchObject({
      needRefresh: true,
      canPromptNow: false,
    });
    await expect(page.getByText('A new version is ready.')).toHaveCount(0);

    // Update is refused while the punch is queued: nothing reloads, the new worker keeps waiting.
    await page.evaluate(() => window.__fsPwa?.applyUpdate());
    await page.waitForTimeout(1_000);
    expect(
      await page.evaluate(
        async () => (await navigator.serviceWorker.getRegistration('/'))?.waiting !== null,
      ),
    ).toBe(true);
    expect(await page.evaluate(() => window.__fsPwa?.queue().items.length)).toBe(1);

    // Once the queue is empty the prompt may show.
    await page.evaluate((key) => window.__fsPwa?.removeQueued(key), QUEUED_KEY);
    await page.waitForFunction(() => window.__fsPwa?.state().canPromptNow === true);

    // Update: SKIP_WAITING, then one reload under the new worker.
    const reloaded = page.waitForEvent('load');
    await page.evaluate(() => window.__fsPwa?.applyUpdate());
    await reloaded;
    await page.waitForFunction(
      () => navigator.serviceWorker.controller?.scriptURL.includes('e2e=next') === true,
    );
  });

  test('E2E-11 an offline check-in is queued and syncs with the offline tag', async ({
    page,
    context,
    request,
    reset,
    setServerClock,
    setGeo,
  }, testInfo) => {
    onlyAndroid(testInfo);
    test.setTimeout(150_000);

    // Server time: today at 10:05 IST, inside a Full day shift (10:00-20:00).
    const serverNow = todayAtIst('10:05');
    await setServerClock(serverNow);
    const seeded = await reset('basic-salon');
    const owner = await signInOwner(request, seeded.owner);
    const staff = await owner.addStaff(serverNow);

    // The person joins on this phone (WP-3's join screens) and the owner approves the device.
    await setGeo('inside');
    await joinOnThisPhone(page, staff.code);
    await owner.approvePendingDevice(staff.id);
    await expect(page.getByRole('heading', { level: 1, name: /Riya/ })).toBeVisible({
      timeout: 30_000,
    });

    // The shell gets this phone ready to check in offline while it is online (PRD 4.3.6).
    await expect.poll(() => offlineReady(page), { timeout: 20_000 }).toBe(true);

    await context.setOffline(true);
    await page.getByRole('button', { name: 'Check in', exact: true }).click();
    const sheet = page.getByRole('dialog');
    // The phone's own clock may be outside the shift: answer the sheet's question if it asks.
    const anyway = sheet.getByRole('button', { name: 'Check in anyway' });
    const pinPad = sheet.getByRole('textbox', { name: 'Enter your PIN' });
    await expect(anyway.or(pinPad)).toBeVisible({ timeout: 30_000 });
    if (await anyway.isVisible()) await anyway.click();
    await expect(pinPad).toBeVisible({ timeout: 30_000 });
    await enterPin(sheet, 'Enter your PIN', STAFF_PIN);
    await sheet.getByRole('button', { name: 'Check in', exact: true }).click();

    // S-09.1 stored on the phone and shown as waiting.
    const saved = sheet.getByText('Saved on your phone');
    const problem = sheet.locator('[data-punch-step="problem"]');
    await expect(saved.or(problem)).toBeVisible({ timeout: 20_000 });
    if (await problem.isVisible()) {
      const why = await problem.getAttribute('data-punch-reason');
      throw new Error(`offline check-in failed: ${why}; store: ${await storeSummary(page)}`);
    }
    await sheet.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByText('1 check-in waiting to send')).toBeVisible();
    // S-09.4 no plaintext PIN in IndexedDB.
    expect(await queuedText(page)).not.toContain(`"pin":"${STAFF_PIN}"`);

    // S-09.2 back online: the queue sends it by itself; the server keeps it as an offline punch.
    await context.setOffline(false);
    await expect(page.getByText('1 check-in waiting to send')).toHaveCount(0, { timeout: 45_000 });
    const today = await page.evaluate(async () => {
      const res = await fetch('/api/v1/me/today', { headers: { 'X-FS-Client': '0.1.0' } });
      return (await res.json()) as { punches: { kind: string; source: string; status: string }[] };
    });
    expect(today.punches.at(-1)).toMatchObject({ kind: 'in', source: 'offline' });
  });
});
