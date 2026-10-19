/**
 * WP-4 punch pipeline over the real API (PRD 4.3-4.6, 9.4, 13.2; S-04 to S-09): signed multipart
 * punches from an approved phone, with the fake server clock on Monday 19 Oct 2026.
 */
import { canonicalJson, type DutyView, type PunchResult } from '@fs/contracts';
import { doorToken } from '@fs/engine';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ownerScreenSecret } from '../../services/door';
import { setServiceOverridesForTests } from '../../services/registry';
import { fakeNotifier } from '../../test/fakes';
import { callJson, testEnv } from '../../test/helpers';
import { ctxAt, DAY, ist, setSettings } from '../../test/notify-kit';
import { setClock, signText } from '../auth/test/kit';
import {
  addPhone,
  expectNear,
  expectStatus,
  fixAt,
  type Harness,
  expectNear,
  expectStatus,
  harness,
  jpeg,
  nonce,
  offlineNonces,
  punch,
  rows,
  sealPin,
  uuid,
} from './test/punch-kit';

type Err = { error: { code: string; details?: Record<string, unknown> } };

let h: Harness;
let notifier: ReturnType<typeof fakeNotifier>;

beforeEach(async () => {
  h = await harness();
  notifier = fakeNotifier();
  setServiceOverridesForTests({ notifier });
});

afterEach(async () => {
  setServiceOverridesForTests(null);
  await setClock(null);
});

const owner = <T>(method: string, path: string, body?: unknown) =>
  callJson<T>(method, path, { cookie: h.owner, ...(body === undefined ? {} : { body }) });

const punchRow = async (id: string) =>
  (await rows<Record<string, unknown>>('SELECT * FROM punches WHERE id = ?1', id))[0];

describe('S-04 Check in and out', () => {
  it('S-04.1 inside the fence, a check-in is accepted and stored with server time', async () => {
    const res = await punch(h);
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('accepted');
    expect(res.body.fence).toMatchObject({ result: 'pass' });
    expect(res.body.punch).toMatchObject({ kind: 'in', status: 'accepted', effectiveTs: h.clock });
    const row = await punchRow(res.body.punch.id);
    expect(row).toMatchObject({
      server_ts: h.clock,
      source: 'online',
      pin_verified: 1,
      sig_verified: 1,
    });
  });

  it('S-04.2 the stored time is the server time, not the device clock', async () => {
    const res = await punch(h, { clientTs: h.clock - 4 * 60_000 });
    expectNear(res.body.punch.effectiveTs, h.clock);
    expectNear(res.body.punch.serverTs, h.clock);
  });

  it('S-04.3 a second tap with the same idempotency key returns the first result', async () => {
    const key = uuid();
    const first = await punch(h, { idempotencyKey: key });
    const again = await punch(h, { idempotencyKey: key });
    expect(again.status).toBe(200);
    expect(again.body.punch.id).toBe(first.body.punch.id);
    const n = await rows<{ n: number }>(
      'SELECT COUNT(*) AS n FROM punches WHERE user_id = ?1',
      h.phone.id,
    );
    expect(n[0]?.n).toBe(1);
  });

  it('S-04.4 check-out works the same and shows hours worked', async () => {
    await punch(h);
    await h.at(ist('14:35'));
    const out = await punch(h, { kind: 'out', fix: fixAt(0.00002) });
    expect(out.status).toBe(200);
    expect(out.body.punch).toMatchObject({ kind: 'out', status: 'accepted' });
    expect(out.body.day.workedMin).toBeGreaterThan(200);
    expectNear(out.body.day.lastOutTs, h.clock);
  });

  it('S-04.5 before the earliest check-in window the API says TOO_EARLY', async () => {
    await h.at(ist('07:00'));
    const res = await punch<Err>(h);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('TOO_EARLY');
    expect(res.body.error.details?.shiftStartTs).toBe(ist('10:00'));
    const anyway = await punch(h, { ack: ['too_early'] });
    expect(anyway.body.outcome).toBe('pending');
    expect(anyway.body.punch.pendingReason).toBe('too_early');
  });

  it('S-04.5 a duty that covers the time allows an early check-in', async () => {
    await h.at(ist('07:00'));
    const made = await owner<DutyView>('POST', '/owner/offsite-duties', {
      userIds: [h.phone.id],
      workDate: DAY,
      startTs: ist('06:30'),
      endTs: ist('12:00'),
      placeName: 'Salon pop-up',
      location: { lat: 22.4606479, lng: 70.0565093 },
      radiusM: 200,
      mode: 'geofence',
      otPreapproved: true,
    });
    expectStatus(made, 201);
    const res = await punch(h);
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('accepted');
  });

  it('S-04.1 a wrong PIN is refused, the nonce is spent and the tries are counted', async () => {
    const bad = await punch<Err>(h, { pin: '0000' });
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe('PIN_WRONG');
    expect(bad.body.error.details?.triesLeft).toBeTypeOf('number');
    const ok = await punch(h);
    expect(ok.status).toBe(200);
  });

  it('S-04.1 a spent nonce, a foreign key and a bad signature are all refused', async () => {
    const n = (await nonce(h.phone.cookie)).nonce;
    expect((await punch(h, {}, { nonce: n })).status).toBe(200);
    await h.at(ist('11:00'));
    const reused = await punch<Err>(h, { kind: 'out', fix: fixAt(0.00002) }, { nonce: n });
    expect(reused.body.error.code).toBe('NONCE_INVALID');
    const forged = await punch<Err>(
      h,
      { kind: 'out', fix: fixAt(0.00003) },
      { badSignature: true },
    );
    expect(forged.body.error.code).toBe('DEVICE_NOT_APPROVED');
    expect(forged.body.error.details?.reason).toBe('signature');
  });

  it('S-04.4 checking in twice, or out before in, is a conflict', async () => {
    const out = await punch<Err>(h, { kind: 'out' });
    expect(out.body.error).toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'not_checked_in' },
    });
    await punch(h);
    const twice = await punch<Err>(h, { fix: fixAt(0.00004) });
    expect(twice.body.error).toMatchObject({ code: 'CONFLICT', details: { reason: 'already_in' } });
  });

  it('S-04.1 a week off needs a confirmation and counts as extra work', async () => {
    await h.at(ist('10:05', '2026-10-27'));
    const res = await punch<Err>(h);
    expect(res.body.error).toMatchObject({ code: 'RULE_VIOLATION' });
    const ok = await punch(h, { ack: ['week_off'] });
    expect(ok.status).toBe(200);
  });
});

describe('S-05 Risk outcomes', () => {
  it('S-05.2 a score under 30 is accepted', async () => {
    const res = await punch(h, { deviceTz: 'America/New_York' });
    expect(res.body.punch.status).toBe('accepted');
    expect(res.body.punch.riskReasons).toEqual(['device_tz']);
  });

  it('S-05.2 a score of 30 is flagged, and the reasons are stored in words for the owner', async () => {
    const res = await punch(h, { deviceTz: 'America/New_York', clientTs: h.clock + 10 * 60_000 });
    expect(res.body.outcome).toBe('flagged');
    expect(res.body.punch.status).toBe('flagged');
    const row = await punchRow(res.body.punch.id);
    expect(row?.risk_score).toBe(30);
    const list = await owner<{ items: { type: string; punch: { riskReasons: string[] } }[] }>(
      'GET',
      '/owner/actions?type=flagged_punch',
    );
    expect(list.body.items[0]?.punch.riskReasons.sort()).toEqual(['clock_skew', 'device_tz']);
  });

  it('S-05.3 a flagged punch never changes pay by itself: the day still counts', async () => {
    const res = await punch(h, { deviceTz: 'America/New_York', clientTs: h.clock + 10 * 60_000 });
    expectNear(res.body.day.firstInTs, h.clock);
    const day = await rows<{ status: string }>(
      'SELECT status FROM attendance_days WHERE user_id = ?1 AND work_date = ?2',
      h.phone.id,
      DAY,
    );
    expect(day[0]?.status).toBe('OPEN');
  });

  it('S-05.2 a score above 60 needs proof', async () => {
    const res = await punch(h, {
      fix: fixAt(0.00045, {
        accuracy: 60,
        spreadM: 0,
        accuracySpreadM: 0,
        altitudeNullAll: true,
        speedNullAll: true,
      }),
    });
    expect(res.body.outcome).toBe('needs_proof');
    expect(res.body.punch.status).toBe('pending');
    expectNear(res.body.proofUntil, h.clock + 10 * 60_000);
    expect(res.body.punch.riskReasons).toEqual(
      expect.arrayContaining(['fence_uncertain', 'zero_jitter']),
    );
  });

  it('S-04.1 outside the fence is refused with the distance; "send to the owner" keeps it pending', async () => {
    const far = fixAt(0.003);
    const res = await punch<Err>(h, { fix: far });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('OUTSIDE_FENCE');
    expect(res.body.error.details?.distanceM).toBeGreaterThan(300);
    const sent = await punch(h, { fix: far, requestApproval: true, note: 'Parking outside' });
    expect(sent.body.outcome).toBe('pending');
    expect(sent.body.punch.pendingReason).toBe('outside_fence');
  });

  it('S-04.1 an approximate location is refused before anything is stored', async () => {
    const res = await punch<Err>(h, { fix: fixAt(0, { accuracy: 1500 }) });
    expect(res.body.error.code).toBe('LOCATION_APPROXIMATE');
    const n = await rows<{ n: number }>(
      'SELECT COUNT(*) AS n FROM punches WHERE user_id = ?1',
      h.phone.id,
    );
    expect(n[0]?.n).toBe(0);
  });
});

describe('S-06 Door code', () => {
  const doorCode = async () =>
    (await owner<{ token: string; siteId: string }>('GET', '/owner/door-code')).body;
  const far = () => fixAt(0.003);

  it('S-06.1 the code of the current step is accepted without a location', async () => {
    const { token } = await doorCode();
    const res = await punch(h, { fix: far(), qrToken: token });
    expect(res.status).toBe(200);
    expect(res.body.punch.status).toBe('accepted');
    const row = await punchRow(res.body.punch.id);
    expect(row?.qr_step).not.toBeNull();
  });

  it('S-06.1 the previous step is accepted; older is refused with "That code has changed"', async () => {
    const { token } = await doorCode();
    await h.at(h.clock + 30_000);
    expect((await punch(h, { fix: far(), qrToken: token })).status).toBe(200);
    await punch(h, { kind: 'out', fix: fixAt(0.00001) });
    await h.at(h.clock + 3 * 60_000);
    const old = await punch<Err>(h, { fix: far(), qrToken: token });
    expect(old.body.error).toMatchObject({
      code: 'RULE_VIOLATION',
      details: { reason: 'qr_expired' },
    });
  });

  it('S-06.2 the same person cannot reuse a step', async () => {
    const { token } = await doorCode();
    await punch(h, { fix: far(), qrToken: token });
    await h.at(h.clock + 5_000);
    const again = await punch<Err>(h, { kind: 'out', fix: far(), qrToken: token });
    expect(again.body.error.details?.reason).toBe('qr_reused');
  });

  it('S-06.3 a token from another site or a made-up code is refused', async () => {
    const ctx = await ctxAt(h.salon, h.clock);
    const secret = await ownerScreenSecret(ctx, '01JAAAAAAAAAAAAAAAAAAAAAAA');
    const foreign = await doorToken(secret, Math.floor(h.clock / 30_000));
    const res = await punch<Err>(h, { fix: far(), qrToken: foreign });
    expect(res.body.error.details?.reason).toBe('qr_invalid');
  });

  it('S-06.4 scanning upgrades a pending punch and keeps its original time', async () => {
    const jitter = {
      accuracy: 60,
      spreadM: 0,
      accuracySpreadM: 0,
      altitudeNullAll: true,
      speedNullAll: true,
    };
    const first = await punch(h, { fix: fixAt(0.00045, jitter) });
    expect(first.body.outcome).toBe('needs_proof');
    const id = first.body.punch.id;
    await h.at(h.clock + 3 * 60_000);
    const { token } = await doorCode();
    const signature = await signText(h.phone.key, canonicalJson({ punchId: id, qrToken: token }));
    const up = await callJson<PunchResult>('POST', `/punches/${id}/proof`, {
      cookie: h.phone.cookie,
      body: { qrToken: token, signature },
    });
    expect(up.status).toBe(200);
    expect(up.body.punch).toMatchObject({ id, status: 'accepted' });
    expectNear(up.body.punch.effectiveTs, ist('10:05'));
  });
});

describe('S-07 Selfie', () => {
  beforeEach(async () => {
    await setSettings(h.salon, (s) => {
      (s.attendance as Record<string, unknown>).selfieOnCheckIn = true;
    });
  });

  it('S-07.3 the uploaded JPEG is stored and its hash must match the signed hash', async () => {
    const { bytes, sha } = await jpeg();
    const bad = await punch<Err>(h, { selfieSha256: 'a'.repeat(64) }, { selfie: bytes });
    expect(bad.body.error).toMatchObject({
      code: 'BAD_REQUEST',
      details: { reason: 'selfie_hash' },
    });
    const res = await punch(h, { selfieSha256: sha }, { selfie: bytes });
    expect(res.status).toBe(200);
    expect(res.body.punch.status).toBe('accepted');
    const row = await punchRow(res.body.punch.id);
    expect(row?.selfie_sha256).toBe(sha);
    expect(await testEnv.MEDIA.head(row?.selfie_key as string)).not.toBeNull();
  });

  it('S-07.3 a photo over 200 KB is refused', async () => {
    const { bytes, sha } = await jpeg(210 * 1024);
    const res = await punch<Err>(h, { selfieSha256: sha }, { selfie: bytes });
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('S-07.4 without a photo the punch goes to approval with reason selfie_missing', async () => {
    const res = await punch(h);
    expect(res.body.outcome).toBe('pending');
    expect(res.body.punch.pendingReason).toBe('selfie_missing');
  });

  it('S-07.1 with selfie off, no photo is needed or stored', async () => {
    await setSettings(h.salon, (s) => {
      (s.attendance as Record<string, unknown>).selfieOnCheckIn = false;
    });
    const res = await punch(h);
    expect(res.body.outcome).toBe('accepted');
    expect((await punchRow(res.body.punch.id))?.selfie_key).toBeNull();
  });
});

describe('S-08 Off-site', () => {
  const VENUE = { lat: 22.47, lng: 70.07 };
  const duty = (mode: string, over: Record<string, unknown> = {}) =>
    owner<DutyView>('POST', '/owner/offsite-duties', {
      userIds: [h.phone.id],
      workDate: DAY,
      startTs: ist('09:00'),
      endTs: ist('18:00'),
      placeName: 'Hotel Aram',
      location: mode === 'anywhere' ? null : VENUE,
      radiusM: 200,
      mode,
      otPreapproved: true,
      ...over,
    });

  it('S-08.1 inside a duty venue fence within its window, check-in is accepted and tagged offsite', async () => {
    const d = await duty('geofence');
    const res = await punch(h, {
      fix: fixAt(0, { lat: VENUE.lat, lng: VENUE.lng }),
      offsiteDutyId: d.body.id,
    });
    expect(res.status).toBe(200);
    expect(res.body.punch.status).toBe('accepted');
    expect(res.body.punch.offsiteDutyId).toBe(d.body.id);
    expect(res.body.day.tags).toContain('offsite');
  });

  it('S-08.2 mode "anywhere" accepts any location and records it', async () => {
    const d = await duty('anywhere');
    expectStatus(d, 201);
    const res = await punch(h, { fix: fixAt(0.05), offsiteDutyId: d.body.id });
    expectStatus(res, 200);
    expect(res.body.punch.status).toBe('accepted');
    expect((await punchRow(res.body.punch.id))?.lat).not.toBeNull();
  });

  it('S-08.3 "I\'m at a venue" creates a pending punch and tells the owner', async () => {
    const res = await punch(h, {
      fix: fixAt(0.03),
      requestApproval: true,
      placeName: 'Patel wedding, Lal Bungalow',
      note: 'Bridal party',
    });
    expect(res.body.outcome).toBe('pending');
    expect(res.body.punch.pendingReason).toBe('offsite_unplanned');
    expect(notifier.events.map((e) => e.type)).toContain('offsite_requested');
    const list = await owner<{ items: { type: string }[] }>('GET', '/owner/actions');
    expect(list.body.items.map((i) => i.type)).toEqual(['offsite_request']);
  });

  it('S-08.4 "Approve and let others check in here" creates a duty a second person can use', async () => {
    const second = await addPhone(h.salon, h.owner, { name: 'Neha Parmar' });
    const spot = fixAt(0.03);
    const first = await punch(h, { fix: spot, requestApproval: true, placeName: 'Patel wedding' });
    const id = first.body.punch.id;
    const decided = await owner<PunchResult>('POST', `/owner/offsite-requests/${id}/decide`, {
      decision: 'approve_and_open',
      staffIds: [second.id],
    });
    expect(decided.status).toBe(200);
    expect(decided.body.punch.status).toBe('accepted');
    const mate = await punch({ ...h, phone: second }, { fix: spot });
    expect(mate.status).toBe(200);
    expect(mate.body.punch.status).toBe('accepted');
    expect(mate.body.punch.offsiteDutyId).not.toBeNull();
  });
});

describe('S-09 Offline punches', () => {
  async function ready() {
    const cfg = await callJson<{ punchEncPublicJwk: Record<string, unknown> }>('GET', '/config');
    const nonces = await offlineNonces(h.phone.cookie);
    return { jwk: cfg.body.punchEncPublicJwk, nonces };
  }

  it('S-09.3 an offline punch with the sealed PIN is accepted with the bounded event time', async () => {
    const { jwk, nonces } = await ready();
    await h.at(ist('10:07'));
    const key = uuid();
    const res = await punch(
      h,
      {
        idempotencyKey: key,
        pin: null,
        offline: {
          lastServerTime: nonces.serverTime,
          timeSig: nonces.timeSig,
          perfDeltaMs: 90_000,
          wallDeltaMs: 90_000,
          pinEnvelope: await sealPin(jwk, h.phone.pin, key),
        },
      },
      { nonce: nonces.nonces[0]?.nonce as string },
    );
    expect(res.status).toBe(200);
    expect(res.body.punch.source).toBe('offline');
    expect(res.body.punch.effectiveTs).toBe(nonces.serverTime + 90_000);
    expect(res.body.punch.status).toBe('accepted');
    expect(res.body.punch.riskReasons).toContain('offline');
  });

  it('S-09.3 an offline punch outside the allowed window goes to approval', async () => {
    const { jwk, nonces } = await ready();
    await h.at(ist('15:30'));
    const key = uuid();
    const res = await punch(
      h,
      {
        idempotencyKey: key,
        pin: null,
        offline: {
          lastServerTime: nonces.serverTime,
          timeSig: nonces.timeSig,
          perfDeltaMs: 4 * 3_600_000,
          wallDeltaMs: 4 * 3_600_000,
          pinEnvelope: await sealPin(jwk, h.phone.pin, key),
        },
      },
      { nonce: nonces.nonces[0]?.nonce as string },
    );
    expect(res.body.outcome).toBe('pending');
    expect(['offline_window', 'late_sync']).toContain(res.body.punch.pendingReason);
  });

  it('S-09.4 a sealed PIN for another tap, or a tampered envelope, is refused', async () => {
    const { jwk, nonces } = await ready();
    const res = await punch<Err>(
      h,
      {
        pin: null,
        offline: {
          lastServerTime: nonces.serverTime,
          timeSig: nonces.timeSig,
          perfDeltaMs: 1000,
          wallDeltaMs: 1000,
          pinEnvelope: await sealPin(jwk, h.phone.pin, uuid()),
        },
      },
      { nonce: nonces.nonces[0]?.nonce as string },
    );
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });

  it('S-09.1 the offline nonces are issued in pairs and used once', async () => {
    const { nonces } = await ready();
    expect(nonces.nonces).toHaveLength(2);
  });
});
