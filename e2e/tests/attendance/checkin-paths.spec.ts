/**
 * Check-in paths that are not a clean pass (PRD 14.4), on a real staff phone with the owner driven
 * through the API against the real session, step-up and idempotency code. The server clock is
 * pinned to a working Monday; the phone's own clock is not, so every punch carries a clock-skew
 * signal. Scores (PRD 4.4.3): edge fix = uncertain fence 35, new phone 10, clock skew 15 = 60 (flag
 * at 30, proof above 60); a phone in a foreign time zone adds 15 = 75 (needs proof).
 *
 *   E2E-05  check in at the edge, flagged, the owner clears the flag
 *   E2E-06  needs proof, door code typed (the fake camera cannot show a QR), accepted with the
 *           original time; outside the fence, door code, accepted
 *   E2E-07  approximate location and denied permission: fix-it guide, send to the owner, approved
 *
 * Selectors are roles, labels and `data-*` markers only, so the UI redesign cannot break them.
 */
import type {
  ActionsView,
  DoorCode,
  OwnerDayDetail,
  PunchResult,
  TodayBoard,
  TodayView,
} from '@fs/contracts';
import type { Page } from '@playwright/test';
import { expect, test } from '../../fixtures';
import {
  enterPin,
  expectStep,
  ist,
  onboardPhone,
  ownerSession,
  punch,
  punchStep,
  staffApi,
  startPunch,
} from '../flows/helpers';

const PIN = '4826';
const DATE = '2026-09-28';
const NOW = ist(DATE, '10:25');

test.beforeEach(async ({ page: _page }, testInfo) => {
  test.skip(testInfo.project.name !== 'staff-android', 'Needs a staff phone with a session');
});

test.afterEach(async ({ setServerClock }) => {
  await setServerClock(null);
});

const person = (n: number) => ({
  name: 'Meera Desai',
  phone: `98240556${String(n).padStart(2, '0')}`,
  pin: PIN,
  joinDate: '2026-09-01',
});

test.describe('E2E-05 the edge of the fence', () => {
  test('E2E-05 check in at the edge, it is flagged, the owner clears the flag', async ({
    page,
    request,
    reset,
    setServerClock,
    setGeo,
  }) => {
    test.setTimeout(120_000);
    const seeded = await reset('basic-salon');
    await setServerClock(NOW);
    const owner = await ownerSession(request, seeded.owner);
    await setGeo('edge');
    const me = await onboardPhone(page, owner, person(1));

    // She checks in; the sheet looks like a normal success, the flag is the owner's business.
    await punch(page, 'in', PIN);

    const board = await owner.ok<TodayBoard>('GET', '/owner/today');
    const row = board.in.find((r) => r.user.id === me.id);
    expect(row, 'the Today board lists her as in').toBeTruthy();
    expect(row?.flagged).toBe(true);

    const waiting = await owner.ok<ActionsView>('GET', '/owner/actions?type=flagged_punch');
    const item = waiting.items.find((i) => i.type === 'flagged_punch' && i.user.id === me.id);
    expect(item, 'the flagged punch waits in Needs action').toBeTruthy();
    if (item?.type !== 'flagged_punch') throw new Error('not a flagged punch');
    expect(item.punch.status).toBe('flagged');
    expect(item.punch.fenceResult).toBe('uncertain');
    expect(item.punch.riskReasons).toContain('fence_uncertain');
    const originalTs = item.punch.effectiveTs;

    // Looks fine: the flag is gone, the time and the day stay as they were.
    const cleared = await owner.ok<PunchResult>('POST', `/owner/punches/${item.punch.id}/review`, {
      decision: 'clear',
    });
    expect(cleared.punch.status).toBe('accepted');
    expect(cleared.punch.effectiveTs).toBe(originalTs);

    const after = await owner.ok<ActionsView>('GET', '/owner/actions?type=flagged_punch');
    expect(after.items.some((i) => i.type === 'flagged_punch' && i.user.id === me.id)).toBe(false);
    const day = await owner.ok<OwnerDayDetail>('GET', `/owner/days/${me.id}/${DATE}`);
    expect(day.punches.map((p) => [p.kind, p.status])).toEqual([['in', 'accepted']]);
    const board2 = await owner.ok<TodayBoard>('GET', '/owner/today');
    expect(board2.in.find((r) => r.user.id === me.id)?.flagged).toBe(false);
  });
});

/** Open the in-sheet scanner, switch to typing, and send the owner's current door code. */
async function typeDoorCode(page: Page, token: string) {
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('button', { name: 'Scan door code' }).click();
  await expectStep(page, 'scanning');
  await sheet.getByRole('button', { name: 'Type the code' }).click();
  await sheet.getByLabel('Door code').fill(token);
  await sheet.getByRole('button', { name: 'Use this code' }).click();
}

test.describe('E2E-06 proof with the door code', () => {
  test.describe('a phone in a foreign time zone', () => {
    test.use({ timezoneId: 'America/New_York' });

    test('E2E-06 needs proof, the door code is typed, accepted with the original time', async ({
      page,
      request,
      reset,
      setServerClock,
      setGeo,
    }) => {
      test.setTimeout(150_000);
      const seeded = await reset('basic-salon');
      await setServerClock(NOW);
      let owner = await ownerSession(request, seeded.owner);
      await setGeo('edge');
      const me = await onboardPhone(page, owner, person(2));
      const staff = staffApi(page);

      // Edge fix, new phone, skewed clock and a foreign zone: the punch waits for proof.
      expect(await startPunch(page, 'in')).toBe('pin');
      await enterPin(page, 'in', PIN);
      await expectStep(page, 'result');
      const sheet = page.getByRole('dialog');
      await expect(sheet.getByText('One more step')).toBeVisible();
      await expect(sheet.getByText(/Your time stays/)).toBeVisible();
      const today = await staff<TodayView>('GET', '/me/today');
      const waiting = today.body.punches.find((p) => p.kind === 'in');
      expect(waiting?.status).toBe('pending');
      expect(waiting?.pendingReason).toBe('needs_proof');
      const originalTs = waiting?.effectiveTs ?? 0;

      // A little later she is at the door; the owner's "Show door code" screen has a code.
      await setServerClock(NOW + 2 * 60_000);
      owner = await ownerSession(request, seeded.owner);
      const door = await owner.ok<DoorCode>('GET', '/owner/door-code');
      await typeDoorCode(page, door.token);
      await expect(sheet.getByText(/You're in at/)).toBeVisible({ timeout: 30_000 });
      await expect(sheet.getByText('One more step')).toHaveCount(0);

      const done = await staff<TodayView>('GET', '/me/today');
      const accepted = done.body.punches.find((p) => p.kind === 'in');
      expect(accepted?.status).toBe('accepted');
      expect(accepted?.effectiveTs, 'the original time is kept').toBe(originalTs);
      expect(accepted?.riskReasons).toContain('door_qr');
      const day = await owner.ok<OwnerDayDetail>('GET', `/owner/days/${me.id}/${DATE}`);
      expect(day.punches.map((p) => [p.kind, p.status])).toEqual([['in', 'accepted']]);
    });
  });

  test('E2E-06 outside the fence, the door code is typed, accepted', async ({
    page,
    request,
    reset,
    setServerClock,
    setGeo,
  }) => {
    test.setTimeout(120_000);
    const seeded = await reset('basic-salon');
    await setServerClock(NOW);
    const owner = await ownerSession(request, seeded.owner);
    await setGeo('outside');
    const me = await onboardPhone(page, owner, person(3));

    expect(await startPunch(page, 'in')).toBe('problem');
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByText(/from the salon/)).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Scan door code' })).toBeVisible();

    const door = await owner.ok<DoorCode>('GET', '/owner/door-code');
    await typeDoorCode(page, door.token);
    // The code proves the place; the PIN is still asked for.
    await expectStep(page, 'pin', 'result');
    if ((await punchStep(page).getAttribute('data-punch-step')) === 'pin') {
      await enterPin(page, 'in', PIN);
    }
    await expect(sheet.getByText(/You're in at/)).toBeVisible({ timeout: 30_000 });

    const day = await owner.ok<OwnerDayDetail>('GET', `/owner/days/${me.id}/${DATE}`);
    expect(day.punches).toHaveLength(1);
    expect(day.punches[0]?.status).toBe('accepted');
    expect(day.punches[0]?.riskReasons).toContain('door_qr');
  });
});

test.describe('E2E-07 location problems', () => {
  test('E2E-07 approximate location: fix-it guide, send to the owner, approved', async ({
    page,
    request,
    reset,
    setServerClock,
    setGeo,
  }) => {
    test.setTimeout(150_000);
    const seeded = await reset('basic-salon');
    await setServerClock(NOW);
    const owner = await ownerSession(request, seeded.owner);
    await setGeo('approximate');
    const me = await onboardPhone(page, owner, person(4));
    const sheet = page.getByRole('dialog');

    expect(await startPunch(page, 'in')).toBe('problem');
    await expect(sheet.getByText(/approximate location/)).toBeVisible();
    await sheet.getByRole('button', { name: 'How to turn it on' }).click();
    await expect(sheet.locator('[data-fixit="precise"]')).toBeVisible();
    await expect(sheet.getByRole('heading', { name: /approximate location/ })).toBeVisible();
    await sheet.getByRole('button', { name: 'Back' }).click();

    await sheet.getByRole('button', { name: /^Send to / }).click();
    await sheet.getByLabel(/^Add a note for/).fill('Phone shows only an approximate location.');
    await sheet.getByRole('button', { name: /^Send to / }).click();
    await expectStep(page, 'pin');
    await enterPin(page, 'in', PIN);
    await expectStep(page, 'sent');
    await expect(sheet.getByText(/^Sent to /)).toBeVisible();

    const waiting = await owner.ok<ActionsView>('GET', '/owner/actions?type=pending_punch');
    const item = waiting.items.find((i) => i.type === 'pending_punch' && i.user.id === me.id);
    expect(item, 'the request waits in Needs action').toBeTruthy();
    if (item?.type !== 'pending_punch') throw new Error('not a pending punch');
    expect(item.punch.status).toBe('pending');
    expect(item.punch.note).toContain('approximate location');
    const decided = await owner.ok<PunchResult>('POST', `/owner/punches/${item.punch.id}/review`, {
      decision: 'approve',
    });
    expect(decided.punch.status).toBe('accepted');

    const today = await staffApi(page)<TodayView>('GET', '/me/today');
    expect(today.body.punches.find((p) => p.kind === 'in')?.status).toBe('accepted');
    expect(today.body.state).toBe('in');
  });

  test('E2E-07 location permission denied: fix-it guide, send to the owner, approved', async ({
    page,
    request,
    reset,
    setServerClock,
  }) => {
    test.setTimeout(150_000);
    const seeded = await reset('basic-salon');
    await setServerClock(NOW);
    const owner = await ownerSession(request, seeded.owner);
    // No geolocation permission for this phone: the browser refuses the request.
    const me = await onboardPhone(page, owner, person(5));
    const sheet = page.getByRole('dialog');

    expect(await startPunch(page, 'in')).toBe('problem');
    await expect(sheet.getByText('Location is off for this app.')).toBeVisible();
    await sheet.getByRole('button', { name: 'How to turn it on' }).click();
    await expect(sheet.locator('[data-fixit="location"]')).toBeVisible();
    await sheet.getByRole('button', { name: 'Back' }).click();

    await sheet.getByRole('button', { name: /^Send to / }).click();
    await sheet.getByLabel(/^Add a note for/).fill('Location is blocked on my phone.');
    await sheet.getByRole('button', { name: /^Send to / }).click();
    await expectStep(page, 'pin');
    await enterPin(page, 'in', PIN);
    await expectStep(page, 'sent');

    const waiting = await owner.ok<ActionsView>('GET', '/owner/actions?type=pending_punch');
    const item = waiting.items.find((i) => i.type === 'pending_punch' && i.user.id === me.id);
    expect(item, 'the request waits in Needs action').toBeTruthy();
    if (item?.type !== 'pending_punch') throw new Error('not a pending punch');
    const decided = await owner.ok<PunchResult>('POST', `/owner/punches/${item.punch.id}/review`, {
      decision: 'approve',
    });
    expect(decided.punch.status).toBe('accepted');
    const today = await staffApi(page)<TodayView>('GET', '/me/today');
    expect(today.body.state).toBe('in');
  });
});
