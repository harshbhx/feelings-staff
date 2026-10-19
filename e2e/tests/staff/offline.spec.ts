/**
 * Offline queue and update flow end to end (PRD 4.3.6, 11.5, 11.7; E2E-11, E2E-20; AC S-09).
 * Chromium (staff-android) only: it needs service worker control of the page.
 */
import type { Page, TestInfo } from '@playwright/test';
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
    test.fixme(!wired, 'startPwa() is not called by the app yet (main.tsx, WP-1 at integration)');

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
  }, testInfo) => {
    onlyAndroid(testInfo);
    test.fixme(true, 'needs WP-4 punch API and usePunchFlow');
    // Plan: reset('basic-salon'), sign in as staff in the installed context, setGeo('inside'),
    // context.setOffline(true), check in (PIN sealed offline), expect "1 check-in waiting to send",
    // context.setOffline(false), expect the punch on Today with the `offline` tag and an empty queue.
    await page.goto(APP);
  });
});
