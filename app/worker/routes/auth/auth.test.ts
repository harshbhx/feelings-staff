/**
 * WP-3 auth suite (PRD 14.3): join, PIN rules, lockouts, device approval, new device, owner magic
 * link + code, password, step-up, setup, sessions and consents. Named after the ACs in PRD 14.8.
 */
import type { Endpoints, JoinLookup, JoinVerifyResult, Me, OutputOf } from '@fs/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SEED_HOLIDAYS } from '../../seed';
import { setServiceOverridesForTests } from '../../services/registry';
import { fakeEmail, fakeNotifier } from '../../test/fakes';
import {
  call,
  callJson,
  e2eHeaders,
  resetScenario,
  type Scenario,
  sessionFor,
  testEnv,
} from '../../test/helpers';
import {
  approve,
  auditActions,
  cookieFrom,
  createStaff,
  errorCode,
  joinBody,
  joinStaff,
  makeDeviceKey,
  NOTICE_VERSION,
  ownerStepUp,
  setClock,
  signText,
  staffLogin,
} from './test/kit';

const OWNER_EMAIL = 'owner@feelings.test';
const OWNER_PASSWORD = 'feelings-demo-2026';
const OWNER_PIN = '482913';

type SecurityView = OutputOf<Endpoints['ownerSecurityGet']>;
type StepUpResult = OutputOf<Endpoints['stepUp']>;

let s: Scenario;
let notifier: ReturnType<typeof fakeNotifier>;
let email: ReturnType<typeof fakeEmail>;

beforeEach(async () => {
  s = await resetScenario('basic-salon');
  notifier = fakeNotifier();
  email = fakeEmail();
  setServiceOverridesForTests({ notifier, email });
});

afterEach(async () => {
  setServiceOverridesForTests(null);
  await setClock(null);
});

describe('S-01 join with an invite', () => {
  it('S-01.1 a valid code + phone shows the staff name', async () => {
    const owner = await sessionFor(s.ownerId);
    const staff = await createStaff(owner);
    const look = await callJson<JoinLookup>('GET', `/join/lookup?code=${staff.invite.code}`);
    expect(look.body).toMatchObject({ status: 'valid', staffFirstName: 'Priya' });
    const res = await callJson<JoinVerifyResult>('POST', '/join/verify', {
      body: { phone: staff.phone.slice(3), code: staff.rawCode.toLowerCase() },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      staffFirstName: 'Priya',
      orgName: 'Feelings Beauty Care',
      ownerDisplayName: 'Urmi',
      consentsRequired: ['privacy_notice'],
      privacyNoticeVersion: NOTICE_VERSION,
    });
  });

  it('S-01.2 rejects 1111, 1234, 4321, 0000 and the last digits of the phone', async () => {
    const owner = await sessionFor(s.ownerId);
    const staff = await createStaff(owner);
    const key = await makeDeviceKey();
    for (const pin of [
      '1111',
      '1234',
      '4321',
      '0000',
      staff.phone.slice(-4),
      staff.phone.slice(-6),
    ]) {
      const res = await call('POST', '/join/complete', {
        body: joinBody({ phone: staff.phone, code: staff.rawCode, pin, key }),
      });
      expect(res.status, pin).toBe(422);
      const err = await errorCode(res);
      expect(err.code).toBe('RULE_VIOLATION');
      expect(err.details?.field).toBe('pin');
    }
    // The invite is still usable after rejected PINs.
    const ok = await joinStaff(staff);
    expect(ok.me.user.status).toBe('active');
  });

  it('S-01.3 join creates a pending device, a privacy consent and a session', async () => {
    const owner = await sessionFor(s.ownerId);
    const staff = await createStaff(owner);
    const joined = await joinStaff(staff);
    expect(joined.me.device?.status).toBe('pending');
    expect(joined.me.user).toMatchObject({
      role: 'staff',
      status: 'active',
      designation: 'Stylist',
    });
    const device = await testEnv.DB.prepare(
      'SELECT public_jwk, jwk_thumbprint, status FROM devices WHERE id = ?1',
    )
      .bind(joined.me.device?.id ?? '')
      .first<{ public_jwk: string; jwk_thumbprint: string; status: string }>();
    expect(device?.status).toBe('pending');
    expect(JSON.parse(device?.public_jwk ?? '{}')).toEqual(joined.key.jwk);
    expect(device?.jwk_thumbprint).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(joined.key.privateKey.extractable).toBe(false);
    const consent = await testEnv.DB.prepare(
      'SELECT kind, version FROM consents WHERE user_id = ?1',
    )
      .bind(staff.id)
      .first<{ kind: string; version: string }>();
    expect(consent).toEqual({ kind: 'privacy_notice', version: NOTICE_VERSION });
    const me = await callJson<Me>('GET', '/me', { cookie: joined.cookie });
    expect(me.body.device?.status).toBe('pending');
    expect(me.body.flags.consentsNeeded).toEqual([]);
    expect(await auditActions(staff.id)).toContain('auth.join');
  });

  it('S-01.4 the owner gets N19 when a phone joins', async () => {
    const owner = await sessionFor(s.ownerId);
    const staff = await createStaff(owner);
    const joined = await joinStaff(staff);
    const n19 = notifier.events.find((e) => e.type === 'new_device');
    expect(n19).toMatchObject({
      type: 'new_device',
      userId: staff.id,
      name: 'Priya Solanki',
      deviceId: joined.me.device?.id,
      deviceLabel: 'Redmi Note 12 · Chrome',
    });
  });

  it('S-01.5 after approval the same session sees the approved phone (waiting screen poll)', async () => {
    const owner = await ownerStepUp(s.ownerId);
    const staff = await createStaff(owner);
    const joined = await joinStaff(staff);
    expect((await approve(owner, joined.me.device?.id ?? '')).status).toBe(200);
    const me = await callJson<Me>('GET', '/me', { cookie: joined.cookie });
    expect(me.status).toBe(200);
    expect(me.body.device?.status).toBe('approved');
    expect(notifier.events.some((e) => e.type === 'device_decided')).toBe(true);
  });

  it('S-01.6 expired, used and unknown codes each have their own state', async () => {
    const owner = await sessionFor(s.ownerId);
    const used = await createStaff(owner);
    await joinStaff(used);
    const expired = await createStaff(owner);

    const lookUsed = await callJson<JoinLookup>('GET', `/join/lookup?code=${used.rawCode}`);
    expect(lookUsed.body.status).toBe('used');
    const resUsed = await call('POST', '/join/verify', {
      body: { phone: used.phone, code: used.rawCode },
    });
    expect(resUsed.status).toBe(410);
    expect(await errorCode(resUsed)).toMatchObject({
      code: 'INVITE_EXPIRED',
      details: { state: 'used' },
    });

    await setClock(Date.now() + 49 * 3_600_000);
    const lookExpired = await callJson<JoinLookup>('GET', `/join/lookup?code=${expired.rawCode}`);
    expect(lookExpired.body).toMatchObject({ status: 'expired', staffFirstName: null });
    const resExpired = await call('POST', '/join/verify', {
      body: { phone: expired.phone, code: expired.rawCode },
    });
    expect(await errorCode(resExpired)).toMatchObject({
      code: 'INVITE_EXPIRED',
      details: { state: 'expired' },
    });

    const lookUnknown = await callJson<JoinLookup>('GET', '/join/lookup?code=ZZZZ-ZZZZ');
    expect(lookUnknown.body).toEqual({
      status: 'unknown',
      staffFirstName: null,
      orgName: null,
      ownerDisplayName: null,
      ownerPhone: null,
    });
  });

  it('S-01.7 the 6th wrong code in an hour returns 429', async () => {
    const owner = await sessionFor(s.ownerId);
    const staff = await createStaff(owner);
    for (let i = 1; i <= 5; i++) {
      const res = await call('POST', '/join/verify', {
        body: { phone: staff.phone, code: 'AAAA-AAAA' },
      });
      expect(res.status).toBe(401);
      expect(await errorCode(res)).toMatchObject({
        code: 'CODE_WRONG',
        details: { triesLeft: 5 - i },
      });
    }
    const sixth = await call('POST', '/join/verify', {
      body: { phone: staff.phone, code: staff.rawCode },
    });
    expect(sixth.status).toBe(429);
    expect((await errorCode(sixth)).code).toBe('RATE_LIMITED');
    expect(Number(sixth.headers.get('Retry-After'))).toBeGreaterThan(0);
    // After the hour the right code works again.
    await setClock(Date.now() + 61 * 60_000);
    const later = await call('POST', '/join/verify', {
      body: { phone: staff.phone, code: staff.rawCode },
    });
    expect(later.status).toBe(200);
  });

  it('asks for the selfie consent when selfies are required', async () => {
    const owner = await sessionFor(s.ownerId);
    const staff = await createStaff(owner, { selfieRequired: true });
    const verify = await callJson<JoinVerifyResult>('POST', '/join/verify', {
      body: { phone: staff.phone, code: staff.rawCode },
    });
    expect(verify.body.consentsRequired).toEqual(['privacy_notice', 'selfie']);
    const key = await makeDeviceKey();
    const res = await call('POST', '/join/complete', {
      body: joinBody({ phone: staff.phone, code: staff.rawCode, key }),
    });
    expect(res.status).toBe(422);
    expect(await errorCode(res)).toMatchObject({
      code: 'RULE_VIOLATION',
      details: { consentsRequired: ['selfie'] },
    });
  });

  it('refuses a wrong phone for a valid code and a malformed phone', async () => {
    const owner = await sessionFor(s.ownerId);
    const staff = await createStaff(owner);
    const wrong = await call('POST', '/join/verify', {
      body: { phone: '9000000001', code: staff.rawCode },
    });
    expect((await errorCode(wrong)).code).toBe('CODE_WRONG');
    const bad = await call('POST', '/join/verify', {
      body: { phone: '12345678901', code: staff.rawCode },
    });
    expect(bad.status).toBe(400);
    expect((await errorCode(bad)).code).toBe('VALIDATION');
  });

  it('shows the storage tip when the browser refused persistent storage', async () => {
    const owner = await sessionFor(s.ownerId);
    const staff = await createStaff(owner);
    const key = await makeDeviceKey();
    const res = await call('POST', '/join/complete', {
      body: joinBody({
        phone: staff.phone,
        code: staff.rawCode,
        key,
        extra: { storagePersisted: false },
      }),
    });
    expect(((await res.json()) as Me).flags.storageTip).toBe(true);
  });
});

describe('S-02 staff sign-in', () => {
  async function approvedStaff() {
    const owner = await ownerStepUp(s.ownerId);
    const staff = await createStaff(owner);
    const joined = await joinStaff(staff);
    await approve(owner, joined.me.device?.id ?? '');
    return { owner, staff, joined, deviceId: joined.me.device?.id ?? '' };
  }

  it('S-02.1 phone + PIN + device signature signs in on an approved device', async () => {
    const { staff, joined, deviceId } = await approvedStaff();
    const res = await staffLogin({
      phone: staff.phone,
      pin: joined.pin,
      deviceId,
      key: joined.key,
    });
    expect(res.status).toBe(200);
    expect(cookieFrom(res)).toBeTruthy();
    const me = (await res.json()) as Me;
    expect(me.user.id).toBe(staff.id);
    expect(me.device).toMatchObject({ id: deviceId, status: 'approved' });
    expect(await auditActions(staff.id)).toContain('auth.staff_login');
  });

  it('S-02.2 a pending or revoked device cannot sign in', async () => {
    const owner = await ownerStepUp(s.ownerId);
    const staff = await createStaff(owner);
    const joined = await joinStaff(staff);
    const deviceId = joined.me.device?.id ?? '';
    const pending = await staffLogin({
      phone: staff.phone,
      pin: joined.pin,
      deviceId,
      key: joined.key,
    });
    expect(pending.status).toBe(403);
    expect(await errorCode(pending)).toMatchObject({
      code: 'DEVICE_NOT_APPROVED',
      details: { deviceStatus: 'pending' },
    });
    await approve(owner, deviceId);
    const revoke = await call('POST', `/owner/devices/${deviceId}/revoke`, {
      cookie: owner,
      body: { reason: 'Phone lost' },
    });
    expect(revoke.status).toBe(200);
    const revoked = await staffLogin({
      phone: staff.phone,
      pin: joined.pin,
      deviceId,
      key: joined.key,
    });
    expect(await errorCode(revoked)).toMatchObject({
      code: 'DEVICE_NOT_APPROVED',
      details: { deviceStatus: 'revoked' },
    });
    // The join session on the revoked phone ended too.
    expect((await call('GET', '/me', { cookie: joined.cookie })).status).toBe(401);
  });

  it('S-02.2 a wrong signature or a reused nonce is refused', async () => {
    const { staff, joined, deviceId } = await approvedStaff();
    const other = await makeDeviceKey();
    const bad = await staffLogin({ phone: staff.phone, pin: joined.pin, deviceId, key: other });
    expect(bad.status).toBe(401);
    expect((await errorCode(bad)).code).toBe('SIGNATURE_INVALID');

    const ch = await callJson<{ nonce: string }>('GET', '/auth/challenge?purpose=login');
    const first = await staffLogin({
      phone: staff.phone,
      pin: joined.pin,
      deviceId,
      key: joined.key,
      nonce: ch.body.nonce,
    });
    expect(first.status).toBe(200);
    const replay = await staffLogin({
      phone: staff.phone,
      pin: joined.pin,
      deviceId,
      key: joined.key,
      nonce: ch.body.nonce,
    });
    expect(replay.status).toBe(409);
    expect((await errorCode(replay)).code).toBe('NONCE_INVALID');

    await setClock(Date.now() + 6 * 60_000);
    const late = await callJson<{ nonce: string }>('GET', '/auth/challenge?purpose=login');
    await setClock(Date.now() + 12 * 60_000);
    const expired = await staffLogin({
      phone: staff.phone,
      pin: joined.pin,
      deviceId,
      key: joined.key,
      nonce: late.body.nonce,
    });
    expect((await errorCode(expired)).code).toBe('NONCE_INVALID');
  });

  it('S-02.3 5 wrong PINs lock for 15 min; 10 in 24 h trigger N21', async () => {
    const { staff, joined, deviceId } = await approvedStaff();
    const base = Date.now();
    await setClock(base);
    for (let i = 1; i <= 4; i++) {
      const res = await staffLogin({ phone: staff.phone, pin: '9631', deviceId, key: joined.key });
      expect(res.status).toBe(401);
      expect(await errorCode(res)).toMatchObject({
        code: 'PIN_WRONG',
        details: { triesLeft: 5 - i },
      });
    }
    const fifth = await staffLogin({ phone: staff.phone, pin: '9631', deviceId, key: joined.key });
    expect(fifth.status).toBe(423);
    const locked = await errorCode(fifth);
    expect(locked.code).toBe('PIN_LOCKED');
    const until = locked.details?.until as number;
    expect(until).toBeGreaterThanOrEqual(base + 15 * 60_000 - 1000);
    expect(locked.message).toMatch(/Try again at \d\d:\d\d\./);
    // Even the right PIN is refused while locked.
    const during = await staffLogin({
      phone: staff.phone,
      pin: joined.pin,
      deviceId,
      key: joined.key,
    });
    expect(during.status).toBe(423);
    expect(notifier.events.some((e) => e.type === 'pin_attempts')).toBe(false);

    await setClock(base + 16 * 60_000);
    for (let i = 1; i <= 5; i++)
      await staffLogin({ phone: staff.phone, pin: '9631', deviceId, key: joined.key });
    const n21 = notifier.events.filter((e) => e.type === 'pin_attempts');
    expect(n21).toHaveLength(1);
    expect(n21[0]).toMatchObject({ userId: staff.id, count: 10, name: 'Priya Solanki' });
    const actions = await auditActions(staff.id);
    expect(actions.filter((a) => a === 'auth.pin_wrong')).toHaveLength(10);
    expect(actions).toContain('auth.pin_locked');

    await setClock(base + 32 * 60_000);
    const ok = await staffLogin({ phone: staff.phone, pin: joined.pin, deviceId, key: joined.key });
    expect(ok.status).toBe(200);
  });

  it('an unknown phone answers like a wrong PIN without revealing tries', async () => {
    await approvedStaff();
    const key = await makeDeviceKey();
    const res = await staffLogin({
      phone: '9898989898',
      pin: '2580',
      deviceId: '01JBZZZZZZZZZZZZZZZZZZZZZZ',
      key,
    });
    expect(res.status).toBe(401);
    const err = await errorCode(res);
    expect(err.code).toBe('PIN_WRONG');
    expect(err.details).toBeUndefined();
  });

  it('new phone: PIN creates a pending device, N19, and approval replaces the old phone', async () => {
    const { owner, staff, joined, deviceId } = await approvedStaff();
    const oldSession = cookieFrom(
      await staffLogin({ phone: staff.phone, pin: joined.pin, deviceId, key: joined.key }),
    );
    const newKey = await makeDeviceKey();
    const nd = await callJson<{ status: string; deviceId: string }>(
      'POST',
      '/auth/staff/new-device',
      {
        body: {
          phone: staff.phone,
          pin: joined.pin,
          deviceJwk: newKey.jwk,
          deviceLabel: 'iPhone · Safari',
          platform: 'ios',
        },
      },
    );
    expect(nd.status).toBe(200);
    expect(nd.body.status).toBe('pending');
    expect(notifier.events.filter((e) => e.type === 'new_device')).toHaveLength(2);

    const waiting = await staffLogin({
      phone: staff.phone,
      pin: joined.pin,
      deviceId: nd.body.deviceId,
      key: newKey,
    });
    expect((await errorCode(waiting)).details).toMatchObject({ deviceStatus: 'pending' });

    expect((await approve(owner, nd.body.deviceId)).status).toBe(200);
    const old = await testEnv.DB.prepare('SELECT status, revoked_reason FROM devices WHERE id = ?1')
      .bind(deviceId)
      .first<{ status: string; revoked_reason: string }>();
    expect(old).toEqual({ status: 'revoked', revoked_reason: 'replaced' });
    expect((await call('GET', '/me', { cookie: oldSession })).status).toBe(401);
    const signedIn = await staffLogin({
      phone: staff.phone,
      pin: joined.pin,
      deviceId: nd.body.deviceId,
      key: newKey,
    });
    expect(signedIn.status).toBe(200);
  });

  it('new phone with a wrong PIN creates nothing', async () => {
    const { staff } = await approvedStaff();
    const key = await makeDeviceKey();
    const res = await call('POST', '/auth/staff/new-device', {
      body: {
        phone: staff.phone,
        pin: '9631',
        deviceJwk: key.jwk,
        deviceLabel: 'iPhone · Safari',
        platform: 'ios',
      },
    });
    expect((await errorCode(res)).code).toBe('PIN_WRONG');
    const n = await testEnv.DB.prepare('SELECT COUNT(*) AS n FROM devices WHERE user_id = ?1')
      .bind(staff.id)
      .first<{ n: number }>();
    expect(n?.n).toBe(1);
  });

  it('someone who has not set a PIN yet is sent back to the join code', async () => {
    const owner = await sessionFor(s.ownerId);
    const staff = await createStaff(owner);
    const key = await makeDeviceKey();
    const res = await call('POST', '/auth/staff/new-device', {
      body: {
        phone: staff.phone,
        pin: '2580',
        deviceJwk: key.jwk,
        deviceLabel: 'x',
        platform: 'android',
      },
    });
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toMatchObject({
      code: 'ACCOUNT_INACTIVE',
      details: { reason: 'pin_not_set' },
    });
  });

  it('logout revokes the session', async () => {
    const { joined } = await approvedStaff();
    const out = await call('POST', '/auth/logout', { cookie: joined.cookie });
    expect(out.status).toBe(204);
    expect((await call('GET', '/me', { cookie: joined.cookie })).status).toBe(401);
  });
});

describe('O-01 owner sign-in', () => {
  async function requestLink() {
    const res = await call('POST', '/auth/owner/magic', { body: { email: OWNER_EMAIL } });
    expect(res.status).toBe(202);
    const msg = email.sent.at(-1);
    if (!msg) throw new Error('no email');
    const code = msg.subject.match(/(\d{6})$/)?.[1] ?? '';
    const token = msg.text.match(/\?t=([A-Za-z0-9_%-]+)/)?.[1] ?? '';
    return { msg, code, token: decodeURIComponent(token) };
  }

  it('O-01.1 the email carries a link and a 6-digit code, 15 min, single use', async () => {
    const { msg, code, token } = await requestLink();
    expect(msg.to).toBe(OWNER_EMAIL);
    expect(msg.subject).toMatch(/^Your Feelings Staff sign-in code: \d{6}$/);
    expect(msg.text).toContain(`${testEnv.APP_ORIGIN}/auth/owner?t=`);
    expect(code).toMatch(/^\d{6}$/);

    const first = await call('POST', '/auth/owner/verify', { body: { token } });
    expect(first.status).toBe(200);
    expect(cookieFrom(first)).toBeTruthy();
    expect(((await first.json()) as Me).user.role).toBe('owner');
    const again = await call('POST', '/auth/owner/verify', { body: { token } });
    expect(again.status).toBe(410);
    expect((await errorCode(again)).code).toBe('LINK_EXPIRED');
    const byCode = await call('POST', '/auth/owner/verify', { body: { email: OWNER_EMAIL, code } });
    expect((await errorCode(byCode)).code).toBe('LINK_EXPIRED');

    const late = await requestLink();
    await setClock(Date.now() + 16 * 60_000);
    const expired = await call('POST', '/auth/owner/verify', { body: { token: late.token } });
    expect((await errorCode(expired)).code).toBe('LINK_EXPIRED');
  });

  it('O-01.2 the 6-digit code signs in (iOS installed app path)', async () => {
    const { code } = await requestLink();
    const res = await callJson<Me>('POST', '/auth/owner/verify', {
      body: { email: 'Owner@Feelings.test', code },
    });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(OWNER_EMAIL);
    expect(res.body.flags.ownerPinSet).toBe(true);
    expect(res.body.flags.ownerPasswordSet).toBe(true);
  });

  it('O-01.2 five wrong codes kill the link', async () => {
    const { code } = await requestLink();
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 1; i <= 5; i++) {
      const res = await call('POST', '/auth/owner/verify', {
        body: { email: OWNER_EMAIL, code: wrong },
      });
      expect(await errorCode(res)).toMatchObject({
        code: 'CODE_WRONG',
        details: { triesLeft: 5 - i },
      });
    }
    const right = await call('POST', '/auth/owner/verify', { body: { email: OWNER_EMAIL, code } });
    expect((await errorCode(right)).code).toBe('LINK_EXPIRED');
  });

  it('O-01.3 password + PIN fallback works', async () => {
    const res = await call('POST', '/auth/owner/password', {
      body: { email: OWNER_EMAIL, password: OWNER_PASSWORD, pin: OWNER_PIN },
    });
    expect(res.status).toBe(200);
    expect(cookieFrom(res)).toBeTruthy();
    const wrongPin = await call('POST', '/auth/owner/password', {
      body: { email: OWNER_EMAIL, password: OWNER_PASSWORD, pin: '135792' },
    });
    expect(await errorCode(wrongPin)).toMatchObject({
      code: 'PIN_WRONG',
      details: { triesLeft: 4 },
    });
  });

  it('O-01.4 step-up is needed for sensitive actions and lasts 10 min', async () => {
    const login = await call('POST', '/auth/owner/password', {
      body: { email: OWNER_EMAIL, password: OWNER_PASSWORD, pin: OWNER_PIN },
    });
    const owner = cookieFrom(login) ?? '';
    const staff = await createStaff(owner);
    const joined = await joinStaff(staff);
    const deviceId = joined.me.device?.id ?? '';

    const needs = [
      () => approve(owner, deviceId),
      () =>
        call('POST', `/owner/staff/${staff.id}/exit`, {
          cookie: owner,
          body: { lastDay: '2026-10-19', reason: 'Moved away' },
        }),
      () =>
        call('PATCH', `/owner/staff/${staff.id}`, {
          cookie: owner,
          body: { salary: { type: 'monthly', amountPaise: 1600000, effectiveFrom: '2026-11-01' } },
        }),
      () =>
        call('PUT', '/owner/security/password', {
          cookie: owner,
          body: { password: 'a long new phrase 2026', pin: OWNER_PIN },
        }),
    ];
    for (const action of needs) {
      const res = await action();
      expect(res.status).toBe(403);
      expect(await errorCode(res)).toMatchObject({
        code: 'STEP_UP_REQUIRED',
        details: { pinSet: true },
      });
    }

    const wrong = await call('POST', '/auth/step-up', { cookie: owner, body: { pin: '135792' } });
    expect((await errorCode(wrong)).code).toBe('PIN_WRONG');
    const base = Date.now();
    await setClock(base);
    const up = await callJson<StepUpResult>('POST', '/auth/step-up', {
      cookie: owner,
      body: { pin: OWNER_PIN },
    });
    expect(up.status).toBe(200);
    expect(up.body.stepUpUntil).toBeGreaterThanOrEqual(base + 10 * 60_000 - 1000);
    const me = await callJson<Me>('GET', '/me', { cookie: owner });
    expect(me.body.flags.stepUpUntil).toBe(up.body.stepUpUntil);
    expect((await approve(owner, deviceId)).status).toBe(200);

    await setClock(base + 11 * 60_000);
    const expired = await call('PATCH', `/owner/staff/${staff.id}`, {
      cookie: owner,
      body: { salary: { type: 'monthly', amountPaise: 1600000, effectiveFrom: '2026-11-01' } },
    });
    expect((await errorCode(expired)).code).toBe('STEP_UP_REQUIRED');
    expect(await auditActions(s.ownerId)).toContain('auth.step_up');
  });

  it('O-01.5 responses never reveal whether an email exists', async () => {
    const unknown = await call('POST', '/auth/owner/magic', {
      body: { email: 'nobody@feelings.test' },
    });
    expect(unknown.status).toBe(202);
    expect(await unknown.text()).toBe('');
    expect(email.sent).toHaveLength(0);
    const known = await call('POST', '/auth/owner/magic', { body: { email: OWNER_EMAIL } });
    expect(known.status).toBe(202);
    expect(await known.text()).toBe('');
    expect(email.sent).toHaveLength(1);

    const noUser = await call('POST', '/auth/owner/password', {
      body: { email: 'nobody@feelings.test', password: OWNER_PASSWORD, pin: OWNER_PIN },
    });
    const badPassword = await call('POST', '/auth/owner/password', {
      body: { email: OWNER_EMAIL, password: 'not-the-password', pin: OWNER_PIN },
    });
    const a = await errorCode(noUser);
    const b = await errorCode(badPassword);
    expect(noUser.status).toBe(badPassword.status);
    expect(a.code).toBe(b.code);
    expect(a.message).toBe(b.message);
    expect(a.details).toEqual(b.details);
    const codeForUnknown = await call('POST', '/auth/owner/verify', {
      body: { email: 'nobody@feelings.test', code: '123456' },
    });
    expect((await errorCode(codeForUnknown)).code).toBe('LINK_EXPIRED');
  });

  it('sends at most 3 links per email in 15 minutes, still answering 202', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await call('POST', '/auth/owner/magic', { body: { email: OWNER_EMAIL } });
      expect(res.status).toBe(202);
    }
    expect(email.sent).toHaveLength(3);
  });

  it('records the email in the preview outbox when no email port is faked', async () => {
    setServiceOverridesForTests({ notifier });
    await call('POST', '/auth/owner/magic', { body: { email: OWNER_EMAIL } });
    const box = await callJson<{
      items: { channel: string; to: string; payload: { subject: string } }[];
    }>('GET', '/__test/outbox', { headers: e2eHeaders() });
    const mail = box.body.items.find((i) => i.channel === 'email');
    expect(mail?.to).toBe(OWNER_EMAIL);
    expect(mail?.payload.subject).toMatch(/sign-in code: \d{6}$/);
  });

  it('a magic-link sign-in lifts an owner PIN lock', async () => {
    for (let i = 0; i < 5; i++)
      await call('POST', '/auth/owner/password', {
        body: { email: OWNER_EMAIL, password: OWNER_PASSWORD, pin: '135792' },
      });
    const locked = await call('POST', '/auth/owner/password', {
      body: { email: OWNER_EMAIL, password: OWNER_PASSWORD, pin: OWNER_PIN },
    });
    expect((await errorCode(locked)).code).toBe('PIN_LOCKED');
    const { token } = await requestLink();
    expect((await call('POST', '/auth/owner/verify', { body: { token } })).status).toBe(200);
    const after = await call('POST', '/auth/owner/password', {
      body: { email: OWNER_EMAIL, password: OWNER_PASSWORD, pin: OWNER_PIN },
    });
    expect(after.status).toBe(200);
  });
});

describe('owner security settings', () => {
  it('sets a password only when it is not common, and changes the PIN with the current one', async () => {
    const owner = await ownerStepUp(s.ownerId);
    const common = await call('PUT', '/owner/security/password', {
      cookie: owner,
      body: { password: 'password123', pin: OWNER_PIN },
    });
    expect(await errorCode(common)).toMatchObject({
      code: 'RULE_VIOLATION',
      details: { passwordProblem: 'common' },
    });
    const ok = await callJson<SecurityView>('PUT', '/owner/security/password', {
      cookie: owner,
      body: { password: 'mehndi season at the salon', pin: OWNER_PIN },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.passwordSet).toBe(true);

    const noCurrent = await call('PUT', '/owner/security/pin', {
      cookie: owner,
      body: { pin: '739164' },
    });
    expect((await errorCode(noCurrent)).code).toBe('VALIDATION');
    const changed = await callJson<SecurityView>('PUT', '/owner/security/pin', {
      cookie: owner,
      body: { pin: '739164', currentPin: OWNER_PIN },
    });
    expect(changed.body.pinSet).toBe(true);
    const step = await call('POST', '/auth/step-up', { cookie: owner, body: { pin: '739164' } });
    expect(step.status).toBe(200);
  });

  it('signs out other sessions and lists them', async () => {
    const a = await sessionFor(s.ownerId);
    const b = await sessionFor(s.ownerId);
    const before = await callJson<SecurityView>('GET', '/owner/security', { cookie: a });
    expect(before.body.sessions.length).toBeGreaterThanOrEqual(2);
    expect(before.body.sessions.filter((x) => x.current)).toHaveLength(1);
    const after = await callJson<SecurityView>('POST', '/owner/security/sign-out-others', {
      cookie: a,
    });
    expect(after.body.sessions).toHaveLength(1);
    expect((await call('GET', '/me', { cookie: b })).status).toBe(401);
    expect((await call('GET', '/me', { cookie: a })).status).toBe(200);
  });

  it('a first owner PIN can be set only soon after signing in', async () => {
    await testEnv.DB.prepare('UPDATE users SET pin_hash = NULL, pin_salt = NULL WHERE id = ?1')
      .bind(s.ownerId)
      .run();
    const owner = await sessionFor(s.ownerId);
    const me = await callJson<Me>('GET', '/me', { cookie: owner });
    expect(me.body.flags.ownerPinSet).toBe(false);
    const step = await call('POST', '/auth/step-up', { cookie: owner, body: { pin: OWNER_PIN } });
    expect(await errorCode(step)).toMatchObject({
      code: 'RULE_VIOLATION',
      details: { pinSet: false },
    });
    const weak = await call('PUT', '/owner/security/pin', {
      cookie: owner,
      body: { pin: '123456' },
    });
    expect((await errorCode(weak)).code).toBe('RULE_VIOLATION');
    await setClock(Date.now() + 16 * 60_000);
    const late = await call('PUT', '/owner/security/pin', {
      cookie: owner,
      body: { pin: '739164' },
    });
    expect(await errorCode(late)).toMatchObject({
      code: 'RULE_VIOLATION',
      details: { reason: 'recent_sign_in_required' },
    });
    await setClock(null);
    const fresh = await sessionFor(s.ownerId);
    const ok = await call('PUT', '/owner/security/pin', { cookie: fresh, body: { pin: '739164' } });
    expect(ok.status).toBe(200);
  });
});

describe('me, consents and access', () => {
  it('UNAUTHENTICATED without a session, FORBIDDEN for staff on owner routes', async () => {
    expect(await errorCode(await call('GET', '/me'))).toMatchObject({ code: 'UNAUTHENTICATED' });
    const owner = await sessionFor(s.ownerId);
    const staff = await createStaff(owner);
    const joined = await joinStaff(staff);
    const res = await call('GET', '/owner/staff', { cookie: joined.cookie });
    expect(res.status).toBe(403);
    expect((await errorCode(res)).code).toBe('FORBIDDEN');
  });

  it('PATCH /me changes the language; only the owner may change the name', async () => {
    const owner = await sessionFor(s.ownerId);
    const staff = await createStaff(owner);
    const joined = await joinStaff(staff);
    const lang = await callJson<Me>('PATCH', '/me', {
      cookie: joined.cookie,
      body: { lang: 'gu' },
    });
    expect(lang.body.user.lang).toBe('gu');
    const name = await call('PATCH', '/me', { cookie: joined.cookie, body: { name: 'P' } });
    expect((await errorCode(name)).code).toBe('FORBIDDEN');
    const ownerName = await callJson<Me>('PATCH', '/me', {
      cookie: owner,
      body: { name: 'Urmi M.' },
    });
    expect(ownerName.body.user.name).toBe('Urmi M.');
  });

  it('a new privacy notice version asks for a fresh acknowledgement; selfie consent can be withdrawn', async () => {
    const owner = await sessionFor(s.ownerId);
    const staff = await createStaff(owner, { selfieRequired: true });
    const key = await makeDeviceKey();
    const res = await call('POST', '/join/complete', {
      body: joinBody({
        phone: staff.phone,
        code: staff.rawCode,
        key,
        extra: {
          consents: [
            { kind: 'privacy_notice', version: NOTICE_VERSION, lang: 'en' },
            { kind: 'selfie', version: NOTICE_VERSION, lang: 'en' },
          ],
        },
      }),
    });
    const cookie = cookieFrom(res) ?? '';
    const withdrawn = await callJson<{ withdrawnAt: number | null }>(
      'POST',
      '/me/consents/selfie/withdraw',
      { cookie },
    );
    expect(withdrawn.body.withdrawnAt).toBeTypeOf('number');
    const me = await callJson<Me>('GET', '/me', { cookie });
    expect(me.body.flags.consentsNeeded).toEqual(['selfie']);
    const notice = await call('POST', '/me/consents/privacy_notice/withdraw', { cookie });
    expect((await errorCode(notice)).code).toBe('RULE_VIOLATION');

    await testEnv.DB.prepare(
      "UPDATE orgs SET settings_json = json_set(settings_json, '$.privacy.noticeVersion', '2027-01-01')",
    ).run();
    const later = await callJson<Me>('GET', '/me', { cookie });
    expect(later.body.flags.consentsNeeded).toContain('privacy_notice');
    const stale = await call('POST', '/me/consents', {
      cookie,
      body: { kind: 'privacy_notice', version: NOTICE_VERSION, lang: 'en' },
    });
    expect((await errorCode(stale)).code).toBe('RULE_VIOLATION');
    const given = await call('POST', '/me/consents', {
      cookie,
      body: { kind: 'privacy_notice', version: '2027-01-01', lang: 'en' },
    });
    expect(given.status).toBe(201);
    const fresh = await callJson<Me>('GET', '/me', { cookie });
    expect(fresh.body.flags.consentsNeeded).toEqual(['selfie']);
  });
});

describe('O-02.1 setup', () => {
  it('works once with the setup token', async () => {
    await resetScenario('empty');
    const body = {
      orgName: 'Feelings Beauty Care',
      ownerEmail: 'owner@feelings.test',
      ownerName: 'Urmi Mengar',
      ownerDisplayName: 'Urmi',
    };
    const noToken = await call('POST', '/setup', { body });
    expect((await errorCode(noToken)).code).toBe('FORBIDDEN');
    const headers = { 'X-Setup-Token': testEnv.SETUP_TOKEN };
    const otherEmail = await call('POST', '/setup', {
      body: { ...body, ownerEmail: 'someone@else.test' },
      headers,
    });
    expect((await errorCode(otherEmail)).code).toBe('RULE_VIOLATION');
    const ok = await callJson<{ orgId: string }>('POST', '/setup', { body, headers });
    expect(ok.status).toBe(201);
    const counts = await testEnv.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM shift_templates) AS t, (SELECT COUNT(*) FROM holidays) AS h,
              (SELECT COUNT(*) FROM leave_types) AS l, (SELECT COUNT(*) FROM sites) AS s,
              (SELECT COUNT(*) FROM users WHERE role = 'owner') AS o`,
    ).first<{ t: number; h: number; l: number; s: number; o: number }>();
    expect(counts).toEqual({ t: 5, h: SEED_HOLIDAYS.length, l: 5, s: 1, o: 1 });
    const again = await call('POST', '/setup', { body, headers });
    expect(again.status).toBe(409);
    expect((await errorCode(again)).code).toBe('CONFLICT');

    // The new owner signs in with the emailed code and is asked to finish setup.
    await call('POST', '/auth/owner/magic', { body: { email: body.ownerEmail } });
    const code = email.sent.at(-1)?.subject.match(/(\d{6})$/)?.[1] ?? '';
    const me = await callJson<Me>('POST', '/auth/owner/verify', {
      body: { email: body.ownerEmail, code },
    });
    expect(me.status).toBe(200);
    expect(me.body.flags).toMatchObject({
      setupIncomplete: true,
      ownerPinSet: false,
      ownerPasswordSet: false,
    });
  });
});

describe('signature helper', () => {
  it('signs exactly like the app (P1363, base64url)', async () => {
    const key = await makeDeviceKey();
    const sig = await signText(key, 'abc');
    expect(sig).toMatch(/^[A-Za-z0-9_-]{86}$/);
  });
});
