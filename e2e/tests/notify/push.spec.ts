import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from '../../fixtures';

interface Shown {
  title: string;
  body?: string;
  tag?: string;
  data: { url: string; e?: string };
}

/**
 * E2E-19 (PRD 14.4, 11.6): the service worker shows a push and a click opens the target.
 *
 * Headless Chromium has no push service, so a real subscription cannot be made here (the server
 * half is covered by notifier.matrix.test.ts and notify.test.ts). This spec delivers a Declarative
 * Web Push payload straight to the installed service worker through the DevTools protocol.
 *
 * The Playwright image cannot display a real notification: as soon as the push handler calls the
 * platform showNotification, the worker restarts and the page target crashes. So the spec records
 * the call instead: inside the worker, `registration.showNotification` is replaced by a recorder
 * that hands each call to the open page. Everything else (the push event, payload parsing, the
 * handler, notificationclick and navigation) is the real code.
 */

/** Replace showNotification in the worker; every call is posted to the page's `recorded` list. */
async function recordNotifications(page: Page, context: BrowserContext) {
  await page.evaluate(() => {
    const w = window as unknown as { recorded: unknown[] };
    w.recorded = [];
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.type === 'e2e-shown') w.recorded.push(e.data.shown);
    });
  });
  const worker = context.serviceWorkers()[0];
  if (!worker) throw new Error('no service worker');
  await worker.evaluate(() => {
    const sw = self as unknown as ServiceWorkerGlobalScope;
    sw.registration.showNotification = async (title: string, options?: NotificationOptions) => {
      const clients = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of clients) {
        c.postMessage({
          type: 'e2e-shown',
          shown: { title, body: options?.body, tag: options?.tag, data: options?.data },
        });
      }
    };
  });
}

const recorded = (page: Page) =>
  page.evaluate(() => (window as unknown as { recorded: Shown[] }).recorded);

async function setup(page: Page, context: BrowserContext) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('ServiceWorker.enable');
  const registrationId = new Promise<string>((resolve) => {
    cdp.on('ServiceWorker.workerRegistrationUpdated', (e) => {
      const r = e.registrations[0];
      if (r) resolve(r.registrationId);
    });
  });
  await page.goto('/signin?allowBrowser=1');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await recordNotifications(page, context);
  const origin = new URL(page.url()).origin;
  const push = async (data: string) =>
    cdp.send('ServiceWorker.deliverPushMessage', {
      origin,
      registrationId: await registrationId,
      data,
    });
  return { origin, push };
}

test.describe('E2E-19 push in the service worker', () => {
  test('E2E-19 a delivered push becomes a notification and its click opens the target', async ({
    page,
    context,
  }, info) => {
    test.skip(info.project.name !== 'staff-android', 'Chromium service worker path');
    const { origin, push } = await setup(page, context);
    const path = '/o/register/01K80VYGQP1PYC7SQGE0Y8BQDX/2026-10-19';
    await push(
      JSON.stringify({
        web_push: 8030,
        notification: {
          title: 'Priya is 18 min late',
          body: 'Checked in 10:28 at the salon.',
          navigate: `${origin}${path}`,
          lang: 'en-IN',
        },
        t: 'late_checkin',
        e: '01K8WN0TQC11QKMBNWMGPP50NM',
        topic: 'late-priya-20261019',
        badge: 1,
      }),
    );
    await expect
      .poll(() => recorded(page), { timeout: 15_000 })
      .toEqual([
        expect.objectContaining({
          title: 'Priya is 18 min late',
          body: 'Checked in 10:28 at the salon.',
          tag: 'late-priya-20261019',
          data: expect.objectContaining({ url: path, e: '01K8WN0TQC11QKMBNWMGPP50NM' }),
        }),
      ]);

    // A click: run the real notificationclick handler with the recorded notification.
    const urls: string[] = [];
    page.on('framenavigated', (f) => {
      if (f === page.mainFrame()) urls.push(new URL(f.url()).pathname);
    });
    const worker = context.serviceWorkers()[0];
    await worker?.evaluate(
      async (data) => {
        const waits: Promise<unknown>[] = [];
        const ev = Object.assign(new Event('notificationclick'), {
          notification: { data, close() {} },
          waitUntil: (p: Promise<unknown>) => waits.push(p),
        });
        self.dispatchEvent(ev);
        await Promise.all(waits);
      },
      (await recorded(page))[0]?.data,
    );
    await expect.poll(() => urls, { timeout: 15_000 }).toContain(path);
  });

  test('E2E-19 a push with no readable body still shows a notification', async ({
    page,
    context,
  }, info) => {
    test.skip(info.project.name !== 'staff-android', 'Chromium service worker path');
    const { push } = await setup(page, context);
    await push('not json');
    await expect
      .poll(async () => (await recorded(page)).map((n) => n.title), { timeout: 15_000 })
      .toEqual(['Feelings']);
  });
});
