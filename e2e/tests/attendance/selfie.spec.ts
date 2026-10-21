/**
 * E2E-08 Selfie on (PRD 4.3, 14.4): a person whose owner requires a photo goes through the camera
 * flow on a real phone (Chromium's fake camera plays e2e/assets/face.y4m), and the owner sees the
 * thumbnail on the day detail. The owner is driven through the API for the setup, then opened in a
 * browser with the same session to look at the screen.
 *
 * Selectors are roles, labels and `data-*` markers only, so the UI redesign cannot break them.
 */
import type { OwnerDayDetail, TodayView } from '@fs/contracts';
import { expect, test } from '../../fixtures';
import {
  enterPin,
  expectStep,
  ist,
  onboardPhone,
  ownerSession,
  staffApi,
  startPunch,
} from '../flows/helpers';

const PIN = '4826';
const DATE = '2026-09-28';
const NOW = ist(DATE, '10:25');

test.beforeEach(async ({ page: _page }, testInfo) => {
  test.skip(testInfo.project.name !== 'staff-android', 'Needs the fake camera of the staff phone');
});

test.afterEach(async ({ setServerClock }) => {
  await setServerClock(null);
});

test.describe('E2E-08 selfie camera flow', () => {
  test('E2E-08 the camera flow takes a photo and the owner sees the thumbnail', async ({
    page,
    browser,
    baseURL,
    request,
    reset,
    setServerClock,
    setGeo,
  }) => {
    test.setTimeout(180_000);
    const seeded = await reset('basic-salon');
    await setServerClock(NOW);
    const owner = await ownerSession(request, seeded.owner);
    // The photo is the point here, not the risk score: keep a runner network from stopping the punch.
    await owner.ok('PATCH', '/owner/settings', { settings: { risk: { flagAt: 30, proofAt: 90 } } });
    await setGeo('inside');
    const me = await onboardPhone(page, owner, {
      name: 'Tanvi Mehta',
      phone: '9824055630',
      pin: PIN,
      joinDate: '2026-09-01',
      selfieRequired: true,
    });

    // Location first, then the camera with its guide; the live preview must be running.
    expect(await startPunch(page, 'in')).toBe('camera');
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByText('Take a quick photo')).toBeVisible();
    const live = sheet.getByLabel('Front camera');
    await expect(live).toBeVisible();
    await expect
      .poll(() => live.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 20_000 })
      .toBeGreaterThan(0);

    // Take the photo. The next screen is the PIN (or a review of the still); a dark photo may be
    // retaken twice, then sent anyway.
    const pad = sheet.getByRole('textbox', { name: 'Enter your PIN' });
    const use = sheet.getByRole('button', { name: 'Use this photo' });
    for (let tries = 0; tries < 3 && !(await pad.isVisible()); tries += 1) {
      await sheet.getByRole('button', { name: 'Take photo' }).click();
      await expect(pad.or(use).or(sheet.getByRole('alert'))).toBeVisible({ timeout: 20_000 });
      if (await use.isVisible()) await use.click();
    }
    const anyway = sheet.getByRole('button', { name: 'Send anyway' });
    if (!(await pad.isVisible()) && (await anyway.isVisible())) await anyway.click();
    await expectStep(page, 'pin');
    await enterPin(page, 'in', PIN);
    await expectStep(page, 'result');
    await expect(sheet.getByText(/You're in at/)).toBeVisible({ timeout: 30_000 });

    const today = await staffApi(page)<TodayView>('GET', '/me/today');
    expect(today.body.punches.find((p) => p.kind === 'in')?.status).toMatch(/accepted|flagged/);

    // The day detail carries a session-checked selfie URL that serves a JPEG.
    const day = await owner.ok<OwnerDayDetail>('GET', `/owner/days/${me.id}/${DATE}`);
    const withPhoto = day.punches.find((p) => p.selfieUrl);
    expect(withPhoto, 'the punch has a selfie').toBeTruthy();
    const file = await request.get(withPhoto?.selfieUrl ?? '', {
      headers: { 'X-FS-Client': '0.1.0' },
    });
    expect(file.status()).toBe(200);
    expect(file.headers()['content-type']).toContain('image/jpeg');
    expect((await file.body()).length).toBeGreaterThan(1_000);

    // And the owner's screen shows the thumbnail: the image loads, it is not the broken-photo note.
    const ownerContext = await browser.newContext({
      baseURL: baseURL ?? 'http://localhost:8787',
      viewport: { width: 1280, height: 800 },
      storageState: await request.storageState(),
    });
    try {
      const ownerPage = await ownerContext.newPage();
      await ownerPage.goto(`/o/register/${me.id}/${DATE}`);
      const thumb = ownerPage.locator('img[src$="/selfie"]').first();
      await expect(thumb).toBeVisible({ timeout: 30_000 });
      await expect
        .poll(() => thumb.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0))
        .toBe(true);
    } finally {
      await ownerContext.close();
    }
  });
});
