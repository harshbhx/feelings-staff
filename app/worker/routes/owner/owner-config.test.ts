/**
 * WP-4 owner configuration API (PRD 4.5, 4.6, 4.15.2, 5.2; O-08 to O-11): roster, shift templates,
 * holidays, sites and calibration, door devices and off-site duties.
 */

import type {
  DutyView,
  Endpoints,
  OutputOf,
  RosterView,
  ShiftTemplateView,
  SiteView,
} from '@fs/contracts';
import { fromBase64Url } from '@fs/contracts';
import { doorToken } from '@fs/engine';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkDoorToken } from '../../services/door';
import { createMapsResolver, parseMapsUrl } from '../../services/maps';
import { setServiceOverridesForTests } from '../../services/registry';
import { fakeNotifier } from '../../test/fakes';
import { call, callJson, sessionFor, testEnv } from '../../test/helpers';
import { addUser, ctxAt, DAY, ist, newSalon, type Salon } from '../../test/notify-kit';
import { setClock } from '../auth/test/kit';

type Pairing = OutputOf<Endpoints['ownerDoorDeviceCreate']>;

let salon: Salon;
let owner: string;
let notifier: ReturnType<typeof fakeNotifier>;

beforeEach(async () => {
  salon = await newSalon();
  owner = await sessionFor(salon.ownerId);
  notifier = fakeNotifier();
  setServiceOverridesForTests({ notifier });
  await setClock(ist('13:00'));
});

afterEach(async () => {
  setServiceOverridesForTests(null);
  await setClock(null);
});

const api = <T>(method: string, path: string, body?: unknown, cookie = owner) =>
  callJson<T>(method, path, { cookie, ...(body === undefined ? {} : { body }) });

const audits = async (action: string) =>
  (
    await testEnv.DB.prepare('SELECT action FROM audit_log WHERE action = ?1')
      .bind(action)
      .all<{ action: string }>()
  ).results;

const salonSite = async () =>
  (await api<SiteView[]>('GET', '/owner/sites')).body.find((s) => s.kind === 'salon') as SiteView;

describe('O-08 Roster', () => {
  it('O-08.1 the week grid shows shifts, week-offs and per-person hours', async () => {
    const priya = await addUser(salon, { name: 'Priya Shah', weekOffDow: 0 });
    const res = await api<RosterView>('GET', '/owner/roster?week=2026-W43');
    expect(res.status).toBe(200);
    expect(res.body.dates[0]).toBe('2026-10-19');
    const row = res.body.rows.find((r) => r.user.id === priya);
    expect(row?.cells[0]).toMatchObject({ kind: 'template', templateName: 'Full day' });
    expect(row?.cells[0]?.segments).toEqual([{ start: '10:00', end: '20:00' }]);
    expect(row?.cells[6]?.kind).toBe('WO');
    expect(res.body.templates.length).toBeGreaterThan(0);
  });

  it('O-08.3 more than 48 scheduled hours in a week shows a warning', async () => {
    const priya = await addUser(salon, { name: 'Priya Shah', weekOffDow: 0 });
    const row = (await api<RosterView>('GET', '/owner/roster?week=2026-W43')).body.rows.find(
      (r) => r.user.id === priya,
    );
    expect(row?.scheduledMin).toBe(6 * 540);
    expect(row?.over48).toBe(true);
  });

  it('O-08.2 swapping week-offs changes both days and tells both people', async () => {
    const a = await addUser(salon, { name: 'Priya Shah', weekOffDow: 0 });
    const b = await addUser(salon, { name: 'Neha Parmar', weekOffDow: 0 });
    const res = await api<RosterView>('PUT', '/owner/roster', {
      changes: [
        { userId: a, date: '2026-10-21', kind: 'week_off' },
        { userId: b, date: '2026-10-22', kind: 'week_off' },
        { userId: a, date: '2026-10-25', kind: 'clear' },
      ],
    });
    expect(res.status).toBe(200);
    const rowA = res.body.rows.find((r) => r.user.id === a);
    expect(rowA?.cells[2]).toMatchObject({ kind: 'WO', override: true });
    const rowB = res.body.rows.find((r) => r.user.id === b);
    expect(rowB?.cells[3]?.kind).toBe('WO');
    expect(notifier.events.filter((e) => e.type === 'schedule_changed')).toHaveLength(3);
    expect(await audits('roster.change')).toHaveLength(3);
  });

  it('O-08.1 shift templates: add, edit, and refuse to remove one in use', async () => {
    const created = await api<ShiftTemplateView>('POST', '/owner/shift-templates', {
      name: 'Late',
      segments: [{ start: '12:00', end: '21:00' }],
      breakMin: 60,
    });
    expect(created.status).toBe(201);
    expect(created.body.scheduledMin).toBe(480);
    const patched = await api<ShiftTemplateView>(
      'PATCH',
      `/owner/shift-templates/${created.body.id}`,
      { breakMin: 30 },
    );
    expect(patched.body.scheduledMin).toBe(510);
    const list = await api<ShiftTemplateView[]>('GET', '/owner/shift-templates');
    const full = list.body.find((t) => t.name === 'Full day') as ShiftTemplateView;
    await addUser(salon, { name: 'Priya Shah' });
    const refused = await api<unknown>('DELETE', `/owner/shift-templates/${full.id}`);
    expect(refused.status).toBe(409);
    const removed = await call('DELETE', `/owner/shift-templates/${created.body.id}`, {
      cookie: owner,
    });
    expect(removed.status).toBe(204);
  });

  it('O-16 holidays turn the day into a holiday and tell staff', async () => {
    const priya = await addUser(salon, { name: 'Priya Shah' });
    const res = await api<{ id: string }>('POST', '/owner/holidays', {
      date: '2026-10-23',
      name: 'Diwali',
      paid: true,
      workedComp: 'extra_pay',
    });
    expect(res.status).toBe(201);
    expect(notifier.events.map((e) => e.type)).toContain('holiday_announced');
    const dup = await api<unknown>('POST', '/owner/holidays', {
      date: '2026-10-23',
      name: 'Again',
      paid: true,
      workedComp: 'extra_pay',
    });
    expect(dup.status).toBe(409);
    const row = (await api<RosterView>('GET', '/owner/roster?week=2026-W43')).body.rows.find(
      (r) => r.user.id === priya,
    );
    expect(row?.cells[4]?.kind).toBe('HO');
    const list = await api<unknown[]>('GET', '/owner/holidays?year=2026');
    expect(list.body).toHaveLength(1);
    expect((await call('DELETE', `/owner/holidays/${res.body.id}`, { cookie: owner })).status).toBe(
      204,
    );
  });
});

describe('O-09 Calibration and sites', () => {
  const session = (id: string, dLat: number) => ({
    sessionId: id,
    platform: 'android',
    samples: [0, 1, 2, 3].map((i) => ({
      lat: 22.4606479 + dLat + i * 0.00001,
      lng: 70.0565093,
      accuracyM: 12 + i,
      takenAt: ist('12:00') + i * 1000,
    })),
  });

  it('O-09.1 stores samples per session', async () => {
    const site = await salonSite();
    const one = await api<{ stored: number; sessions: number }>(
      'POST',
      `/owner/sites/${site.id}/calibration-samples`,
      session('session-one', 0),
    );
    expect(one.body).toEqual({ stored: 4, sessions: 1 });
    const two = await api<{ sessions: number }>(
      'POST',
      `/owner/sites/${site.id}/calibration-samples`,
      session('session-two', 0.00002),
    );
    expect(two.body.sessions).toBe(2);
  });

  it('O-09.2 the proposal follows the median / p95 rule and needs two sessions', async () => {
    const site = await salonSite();
    await api('POST', `/owner/sites/${site.id}/calibration-samples`, session('session-one', 0));
    const early = await api<{ enoughData: boolean }>(
      'POST',
      `/owner/sites/${site.id}/calibration/propose`,
    );
    expect(early.body.enoughData).toBe(false);
    await api(
      'POST',
      `/owner/sites/${site.id}/calibration-samples`,
      session('session-two', 0.00002),
    );
    const res = await api<{
      enoughData: boolean;
      radiusM: number;
      stats: { sessions: number; samples: number };
    }>('POST', `/owner/sites/${site.id}/calibration/propose`);
    expect(res.body.enoughData).toBe(true);
    expect(res.body.stats).toMatchObject({ sessions: 2, samples: 8 });
    expect(res.body.radiusM % 25).toBe(0);
    expect(res.body.radiusM).toBeGreaterThanOrEqual(75);
  });

  it('O-09.3 applying a change needs step-up and is audit-logged', async () => {
    const site = await salonSite();
    const plain = await api<unknown>('PATCH', `/owner/sites/${site.id}`, { radiusM: 125 });
    expect(plain.status).toBe(403);
    const stepped = await sessionFor(salon.ownerId, { stepUp: true });
    const res = await api<SiteView>('PATCH', `/owner/sites/${site.id}`, { radiusM: 125 }, stepped);
    expect(res.status).toBe(200);
    expect(res.body.radiusM).toBe(125);
    expect(await audits('site.update')).toHaveLength(1);
  });

  it('O-09.4 radius and accuracy limits are enforced', async () => {
    const site = await salonSite();
    const stepped = await sessionFor(salon.ownerId, { stepUp: true });
    for (const body of [
      { radiusM: 25 },
      { radiusM: 350 },
      { radiusM: 110 },
      { maxAccuracyM: 20 },
    ]) {
      const res = await api<unknown>('PATCH', `/owner/sites/${site.id}`, body, stepped);
      expect(res.status).toBe(400);
    }
  });
});

describe('O-10 Door code and devices', () => {
  async function pair(label = 'Front desk tablet') {
    const stepped = await sessionFor(salon.ownerId, { stepUp: true });
    const made = await api<Pairing>('POST', '/owner/door-devices', { label }, stepped);
    expect(made.status).toBe(201);
    const paired = await callJson<{ doorDeviceId: string; siteId: string; secret: string }>(
      'POST',
      '/door/pair',
      { body: { pairingCode: made.body.pairingCode } },
    );
    expect(paired.status).toBe(200);
    return { stepped, made: made.body, paired: paired.body };
  }

  it('O-10.1 pairing with a one-time code hands the door device its secret, once', async () => {
    const { made, paired } = await pair();
    expect(paired.doorDeviceId).toBe(made.doorDeviceId);
    expect(fromBase64Url(paired.secret)).toHaveLength(32);
    const again = await callJson('POST', '/door/pair', { body: { pairingCode: made.pairingCode } });
    expect(again.status).toBeGreaterThanOrEqual(400);
    const list = await api<{ id: string; status: string }[]>('GET', '/owner/door-devices');
    expect(list.body).toEqual([
      expect.objectContaining({ id: made.doorDeviceId, status: 'active' }),
    ]);
  });

  it('O-10.2 the door device shows a token the API accepts', async () => {
    const { paired } = await pair();
    const now = ist('13:00');
    const token = await doorToken(fromBase64Url(paired.secret), Math.floor(now / 30_000));
    const check = await checkDoorToken(await ctxAt(salon, now), token, now);
    expect(check).toMatchObject({
      ok: true,
      siteId: paired.siteId,
      doorDeviceId: paired.doorDeviceId,
    });
  });

  it('O-10.3 Show door code on the owner phone works without a door device', async () => {
    const res = await api<{ token: string; url: string; siteId: string }>(
      'GET',
      '/owner/door-code',
    );
    expect(res.status).toBe(200);
    expect(res.body.token).toHaveLength(10);
    expect(res.body.url).toContain(`/q/${res.body.siteId}/${res.body.token}`);
    const now = ist('13:00');
    expect((await checkDoorToken(await ctxAt(salon, now), res.body.token, now)).ok).toBe(true);
  });

  it('O-10.4 rotating invalidates the old tokens at once', async () => {
    const { stepped, paired } = await pair();
    const now = ist('13:00');
    const token = await doorToken(fromBase64Url(paired.secret), Math.floor(now / 30_000));
    const rotated = await api<{ id: string }>(
      'POST',
      `/owner/door-devices/${paired.doorDeviceId}/rotate`,
      undefined,
      stepped,
    );
    expect(rotated.status).toBe(200);
    expect((await checkDoorToken(await ctxAt(salon, now), token, now)).ok).toBe(false);
    const gone = await call('DELETE', `/owner/door-devices/${paired.doorDeviceId}`, {
      cookie: stepped,
    });
    expect(gone.status).toBe(204);
    expect((await api<unknown[]>('GET', '/owner/door-devices')).body).toEqual([]);
  });
});

describe('O-11 Off-site duties', () => {
  const duty = (userIds: string[], over: Record<string, unknown> = {}) => ({
    userIds,
    workDate: '2026-10-21',
    startTs: ist('04:00', '2026-10-21'),
    endTs: ist('09:00', '2026-10-21'),
    placeName: 'Hotel Aram, Jamnagar',
    location: { lat: 22.47, lng: 70.07 },
    radiusM: 200,
    mode: 'geofence',
    otPreapproved: true,
    ...over,
  });

  it('O-11.1 creates a duty with a venue geofence and tells staff', async () => {
    const neha = await addUser(salon, { name: 'Neha Parmar' });
    const res = await api<DutyView>('POST', '/owner/offsite-duties', duty([neha]));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      placeName: 'Hotel Aram, Jamnagar',
      mode: 'geofence',
      otPreapproved: true,
      nightHours: true,
      site: { radiusM: 200 },
    });
    expect(res.body.staff.map((s) => s.id)).toEqual([neha]);
    expect(notifier.events.find((e) => e.type === 'duty_assigned')).toMatchObject({
      change: 'created',
      userIds: [neha],
    });
    expect(await audits('duty.create')).toHaveLength(1);
    const list = await api<DutyView[]>(
      'GET',
      '/owner/offsite-duties?from=2026-10-20&to=2026-10-22',
    );
    expect(list.body.map((d) => d.id)).toEqual([res.body.id]);
  });

  it('O-11.1 "anywhere" needs no location; a geofence duty without one is refused', async () => {
    const neha = await addUser(salon, { name: 'Neha Parmar' });
    const anywhere = await api<DutyView>(
      'POST',
      '/owner/offsite-duties',
      duty([neha], { mode: 'anywhere', location: null }),
    );
    expect(anywhere.status).toBe(201);
    expect(anywhere.body.site).toBeNull();
    const bad = await api<unknown>(
      'POST',
      '/owner/offsite-duties',
      duty([neha], { location: null }),
    );
    expect(bad.status).toBe(400);
  });

  it('O-11.2 the duty window pre-approves overtime when the toggle is on', async () => {
    const neha = await addUser(salon, { name: 'Neha Parmar' });
    const res = await api<DutyView>('POST', '/owner/offsite-duties', duty([neha]));
    const off = await api<DutyView>('PATCH', `/owner/offsite-duties/${res.body.id}`, {
      otPreapproved: false,
    });
    expect(off.body.otPreapproved).toBe(false);
    expect(notifier.events.filter((e) => e.type === 'duty_assigned')).toHaveLength(2);
  });

  it('O-11.3 cancelling removes the duty and tells staff', async () => {
    const neha = await addUser(salon, { name: 'Neha Parmar' });
    const res = await api<DutyView>('POST', '/owner/offsite-duties', duty([neha]));
    const gone = await call('DELETE', `/owner/offsite-duties/${res.body.id}`, { cookie: owner });
    expect(gone.status).toBe(204);
    expect(notifier.events.at(-1)).toMatchObject({ type: 'duty_assigned', change: 'cancelled' });
    const list = await api<DutyView[]>(
      'GET',
      '/owner/offsite-duties?from=2026-10-20&to=2026-10-22',
    );
    expect(list.body).toEqual([]);
    expect(DAY).toBe('2026-10-19');
  });

  it('O-11.1 reads a pasted Google Maps link; other hosts are never opened', async () => {
    expect(
      parseMapsUrl('https://www.google.com/maps/place/Hotel+Aram/@22.4707,70.0577,17z'),
    ).toEqual({
      lat: 22.4707,
      lng: 70.0577,
      label: 'Hotel Aram',
    });
    expect(parseMapsUrl('https://www.google.com/maps?q=22.47,70.05')).toEqual({
      lat: 22.47,
      lng: 70.05,
    });
    expect(parseMapsUrl('https://www.google.com/maps/dir/x/data=!3d22.1!4d70.2')).toEqual({
      lat: 22.1,
      lng: 70.2,
    });
    const hops: string[] = [];
    const resolver = createMapsResolver(async (url) => {
      hops.push(url);
      return new Response(null, {
        status: 302,
        headers: { location: 'https://www.google.com/maps/@22.5,70.1,15z' },
      });
    });
    expect(await resolver.resolve('https://maps.app.goo.gl/abc123')).toEqual({
      lat: 22.5,
      lng: 70.1,
    });
    await expect(resolver.resolve('https://evil.example.com/@22.5,70.1')).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    expect(hops).toHaveLength(1);
    const res = await api<unknown>('POST', '/owner/maps/resolve', {
      url: 'https://evil.example.com/maps',
    });
    expect(res.status).toBe(400);
  });
});
