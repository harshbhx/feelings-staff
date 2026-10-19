import type { BrowserContext } from '@playwright/test';
import { expect, test } from '../../fixtures';

interface Shown {
  title: string;
  body: string;
  tag: string;
  data: { url: string };
}

/** Notifications the service worker is showing, read inside the worker (a page read crashes the headless page). */
async function shown(context: BrowserContext): Promise<Shown[]> {
  const worker = context.serviceWorkers()[0];
  if (!worker) return [];
  return worker.evaluate(async () => {
    const reg = (
      self as unknown as {
        registration: { getNotifications(): Promise<Shown[]> };
      }
    ).registration;
    return (await reg.getNotifications()).map((n) => ({
      title: n.title,
      body: n.body,
      tag: n.tag,
      data: n.data,
    }));
  });
}

/**
 * E2E-19 (PRD 14.4, 11.6): the service worker shows a push and a click opens the target.
 * Headless Chromium has no push service, so a real subscription cannot be made here (the server
 * half is covered by notifier.matrix.test.ts and notify.test.ts). This spec delivers a Declarative
 * Web Push payload straight to the installed service worker through the DevTools protocol and
 * checks what the WP-8 handlers show: the owner's N2 text, its target and the app badge data.
 */
test.describe('E2E-19 push in the service worker', () => {
  test('E2E-19 a delivered push becomes a notification with the in-app target', async ({
    page,
    context,
  }, info) => {
    test.skip(info.project.name !== 'staff-android', 'Chromium service worker path');
    await context.grantPermissions(['notifications']);
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
    const origin = new URL(page.url()).origin;
    const payload = {
      web_push: 8030,
      notification: {
        title: 'Priya is 18 min late',
        body: 'Checked in 10:28 at the salon.',
        navigate: `${origin}/o/register/01K80VYGQP1PYC7SQGE0Y8BQDX/2026-10-19`,
        lang: 'en-IN',
      },
      t: 'late_checkin',
      e: '01K8WN0TQC11QKMBNWMGPP50NM',
      topic: 'late-priya-20261019',
      badge: 1,
    };
    await cdp.send('ServiceWorker.deliverPushMessage', {
      origin,
      registrationId: await registrationId,
      data: JSON.stringify(payload),
    });
    await expect
      .poll(() => shown(context), { timeout: 15_000 })
      .toEqual([
        expect.objectContaining({
          title: 'Priya is 18 min late',
          body: 'Checked in 10:28 at the salon.',
          tag: 'late-priya-20261019',
          data: expect.objectContaining({
            url: '/o/register/01K80VYGQP1PYC7SQGE0Y8BQDX/2026-10-19',
          }),
        }),
      ]);
  });

  test('E2E-19 a push with no readable body still shows a notification', async ({
    page,
    context,
  }, info) => {
    test.skip(info.project.name !== 'staff-android', 'Chromium service worker path');
    await context.grantPermissions(['notifications']);
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
    await cdp.send('ServiceWorker.deliverPushMessage', {
      origin: new URL(page.url()).origin,
      registrationId: await registrationId,
      data: 'not json',
    });
    await expect.poll(async () => (await shown(context)).map((n) => n.title)).toEqual(['Feelings']);
  });
});
