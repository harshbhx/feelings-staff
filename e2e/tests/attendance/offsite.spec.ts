/**
 * Off-site work (PRD 4.6, 14.4), on real staff phones with the owner driven through the API
 * against the real session, step-up and idempotency code. The owner has no screen for duties yet,
 * so the duty is created through the API; everything the staff member sees is the real app.
 *
 *   E2E-09  a pasted Google Maps link becomes an off-site duty, the staff member checks in at the venue
 *   E2E-10  an unplanned venue: "I'm at a venue", the owner approves and lets others check in there,
 *           a second staff member checks in on her own phone
 *
 * Selectors are roles, labels and `data-*` markers only, so the UI redesign cannot break them.
 */
import type {
  ActionsView,
  DutyView,
  OwnerDayDetail,
  PunchResult,
  TodayBoard,
  TodayView,
} from '@fs/contracts';
import { expect, test } from '../../fixtures';
import {
  enterPin,
  expectStep,
  ist,
  newPhone,
  onboardPhone,
  ownerSession,
  punch,
  staffApi,
  startPunch,
} from '../flows/helpers';

const PIN = '4826';
const DATE = '2026-09-28';
const NOW = ist(DATE, '10:25');
/** Hotel Aram, about 1.5 km from the salon. */
const VENUE = { latitude: 22.4707, longitude: 70.0577, accuracy: 18 };
const MAPS_LINK = `https://www.google.com/maps/place/Hotel+Aram/@${VENUE.latitude},${VENUE.longitude},17z/data=!3m1!4b1`;

test.beforeEach(async ({ page: _page }, testInfo) => {
  test.skip(testInfo.project.name !== 'staff-android', 'Needs a staff phone with a session');
});

test.afterEach(async ({ setServerClock }) => {
  await setServerClock(null);
});

test.describe('E2E-09 off-site duty from a Google Maps link', () => {
  test('E2E-09 the owner pastes a link, creates the duty, the staff member checks in at the venue', async ({
    page,
    context,
    request,
    reset,
    setServerClock,
  }) => {
    test.setTimeout(150_000);
    const seeded = await reset('basic-salon');
    await setServerClock(NOW);
    const owner = await ownerSession(request, seeded.owner);
    const me = await onboardPhone(page, owner, {
      name: 'Nisha Rana',
      phone: '9824055610',
      pin: PIN,
      joinDate: '2026-09-01',
    });

    // The pasted link gives the place and the coordinates.
    const spot = await owner.ok<{ lat: number; lng: number; label?: string }>(
      'POST',
      '/owner/maps/resolve',
      { url: MAPS_LINK },
    );
    expect(spot.lat).toBeCloseTo(VENUE.latitude, 4);
    expect(spot.lng).toBeCloseTo(VENUE.longitude, 4);
    expect(spot.label).toBe('Hotel Aram');

    const duty = await owner.ok<DutyView>('POST', '/owner/offsite-duties', {
      userIds: [me.id],
      workDate: DATE,
      startTs: ist(DATE, '10:00'),
      endTs: ist(DATE, '18:00'),
      placeName: spot.label ?? 'Hotel Aram',
      location: { lat: spot.lat, lng: spot.lng },
      radiusM: 150,
      mode: 'geofence',
      otPreapproved: false,
    });
    expect(duty.site?.radiusM).toBe(150);

    // Her Today shows the duty; she is at the venue, not the salon.
    await page.reload();
    await expect(page.getByText('Venue duty today')).toBeVisible();
    await expect(page.getByText(/Hotel Aram/).first()).toBeVisible();
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation(VENUE);
    await punch(page, 'in', PIN);

    const today = await staffApi(page)<TodayView>('GET', '/me/today');
    const mine = today.body.punches.find((p) => p.kind === 'in');
    expect(mine?.status).toBe('accepted');
    expect(mine?.offsiteDutyId).toBe(duty.id);
    expect(mine?.siteName).toBe('Hotel Aram');
    const board = await owner.ok<TodayBoard>('GET', '/owner/today');
    const row = board.in.find((r) => r.user.id === me.id);
    expect(row?.place).toBe('venue');
    expect(board.counters.atVenue).toBeGreaterThanOrEqual(1);
    const day = await owner.ok<OwnerDayDetail>('GET', `/owner/days/${me.id}/${DATE}`);
    expect(day.duty?.id).toBe(duty.id);
  });
});

test.describe('E2E-10 an unplanned venue, opened for others', () => {
  test('E2E-10 approve and let others check in here, a second staff member checks in', async ({
    page,
    context,
    browser,
    baseURL,
    request,
    reset,
    setServerClock,
  }) => {
    test.setTimeout(240_000);
    const seeded = await reset('basic-salon');
    await setServerClock(NOW);
    const owner = await ownerSession(request, seeded.owner);
    const first = await onboardPhone(page, owner, {
      name: 'Pooja Trivedi',
      phone: '9824055620',
      pin: PIN,
      joinDate: '2026-09-01',
    });
    const secondPhone = await newPhone(browser, baseURL ?? 'http://localhost:8787', VENUE);
    try {
      const second = await onboardPhone(secondPhone.page, owner, {
        name: 'Rina Kotak',
        phone: '9824055621',
        pin: PIN,
        joinDate: '2026-09-01',
      });

      // The first one is at a wedding, away from the salon: she says where she is.
      await context.grantPermissions(['geolocation']);
      await context.setGeolocation(VENUE);
      expect(await startPunch(page, 'in')).toBe('problem');
      const sheet = page.getByRole('dialog');
      await sheet.getByRole('button', { name: "I'm at a venue" }).click();
      await sheet.getByLabel('Where are you?').fill('Patel wedding');
      await sheet.getByRole('button', { name: /^Send to / }).click();
      await expectStep(page, 'pin');
      await enterPin(page, 'in', PIN);
      await expectStep(page, 'sent');

      // Needs action shows it as a request to open the venue; the owner lets the second one in too.
      const waiting = await owner.ok<ActionsView>('GET', '/owner/actions?type=pending_punch');
      const item = waiting.items.find((i) => i.type === 'pending_punch' && i.user.id === first.id);
      expect(item, 'the venue request waits in Needs action').toBeTruthy();
      if (item?.type !== 'pending_punch') throw new Error('not a pending punch');
      expect(item.punch.pendingReason).toBe('offsite_unplanned');
      expect(item.punch.placeName).toBe('Patel wedding');
      const opened = await owner.ok<PunchResult>(
        'POST',
        `/owner/offsite-requests/${item.punch.id}/decide`,
        { decision: 'approve_and_open', staffIds: [second.id] },
      );
      expect(opened.punch.status).toBe('accepted');

      // The second one checks in on her own phone at the same place.
      await secondPhone.page.reload();
      await expect(secondPhone.page.getByText('Venue duty today')).toBeVisible();
      await punch(secondPhone.page, 'in', PIN);

      const theirs = await staffApi(secondPhone.page)<TodayView>('GET', '/me/today');
      const punchTwo = theirs.body.punches.find((p) => p.kind === 'in');
      expect(punchTwo?.status).toBe('accepted');
      expect(punchTwo?.siteName).toBe('Patel wedding');
      const board = await owner.ok<TodayBoard>('GET', '/owner/today');
      expect(board.in.find((r) => r.user.id === first.id)?.place).toBe('venue');
      expect(board.in.find((r) => r.user.id === second.id)?.place).toBe('venue');
      const mine = await staffApi(page)<TodayView>('GET', '/me/today');
      expect(mine.body.state).toBe('in');
    } finally {
      await secondPhone.context.close();
    }
  });
});
