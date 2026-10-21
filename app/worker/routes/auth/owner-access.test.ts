/**
 * Owner passkeys, slice 4 (docs/owner-access.md, ADR-19): first-device enrolment after the email code,
 * passkey sign-in and its session, the email-code refusal, and everything off unless OWNER_HOST is set.
 * The browser side is a software authenticator (test/webauthn.ts) with real ES256 and RS256 keys.
 */
import type {
  Me,
  OwnerDeviceList,
  OwnerDeviceView,
  OwnerEnrolOptions,
  OwnerEnrolResult,
  OwnerPasskeyOptions,
} from '@fs/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runJob } from '../../cron';
import { createApp } from '../../index';
import { ownerOrigin } from '../../lib/hosts';
import { hashToken } from '../../middleware/session';
import { setServiceOverridesForTests } from '../../services/registry';
import { fakeEmail, fakeNotifier } from '../../test/fakes';
import { resetScenario, type Scenario, sessionFor, testEnv } from '../../test/helpers';
import { cookieFrom } from './test/kit';
import { type Alg, type Knobs, SoftAuthenticator } from './test/webauthn';

const HOST = 'owner.example.test';
const ORIGIN = `https://${HOST}`;
const STAFF_HOST = 'staff.test';
const EMAIL = 'owner@feelings.test';
const START = Date.parse('2026-10-19T10:42:00+05:30');
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NO_ID = '01JBZZZZZZZZZZZZZZZZZZZZZZ';

let s: Scenario;
let now = START;
let email: ReturnType<typeof fakeEmail>;

// Requests go straight to createApp() so each one can pick its host and whether OWNER_HOST is set.
const pending: Promise<unknown>[] = [];
const execCtx = {
  waitUntil: (p: Promise<unknown>) => {
    pending.push(p);
  },
  passThroughOnException: () => undefined,
  props: {},
} as unknown as ExecutionContext;

interface Opts {
  body?: unknown;
  cookie?: string | null;
  host?: string;
  /** false: OWNER_HOST unset (one host for everything, production today). */
  split?: boolean;
  ip?: string;
  method?: string;
}

interface Res<T> {
  status: number;
  body: T;
  cookie: string | null;
  code: string | undefined;
  reason: unknown;
}

async function req<T = unknown>(path: string, o: Opts = {}): Promise<Res<T>> {
  const host = o.host ?? HOST;
  const env = { ...testEnv, ...(o.split === false ? {} : { OWNER_HOST: HOST }) };
  const headers: Record<string, string> = { Origin: `https://${host}`, 'X-FS-Client': '0.1.0' };
  if (o.cookie) headers.Cookie = `fs_session=${o.cookie}`;
  if (o.ip) headers['CF-Connecting-IP'] = o.ip;
  let body: string | undefined;
  if (o.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(o.body);
  }
  const method = o.method ?? (o.body !== undefined ? 'POST' : 'GET');
  const res = await createApp().fetch(
    new Request(`https://${host}/api/v1${path}`, { method, headers, ...(body ? { body } : {}) }),
    env,
    execCtx,
  );
  await Promise.all(pending.splice(0));
  const text = await res.text();
  const json: unknown = text ? JSON.parse(text) : undefined;
  const error = (json as { error?: { code?: string; details?: { reason?: unknown } } } | undefined)
    ?.error;
  return {
    status: res.status,
    body: json as T,
    cookie: cookieFrom(res),
    code: error?.code,
    reason: error?.details?.reason,
  };
}

const db = (sql: string, ...params: unknown[]) => testEnv.DB.prepare(sql).bind(...params);

async function emailCode(o: Opts = {}): Promise<string> {
  const before = email.sent.length;
  const r = await req('/auth/owner/magic', { ...o, body: { email: EMAIL } });
  expect(r.status).toBe(202);
  expect(email.sent.length).toBe(before + 1);
  const code = email.sent.at(-1)?.subject.match(/(\d{6})$/)?.[1];
  if (!code) throw new Error('no code in the email');
  return code;
}

/** The email-code sign-in on the owner host (the first step of the first device). */
async function emailSignIn(): Promise<string> {
  const code = await emailCode();
  const r = await req<Me>('/auth/owner/verify', { body: { email: EMAIL, code } });
  expect(r.status).toBe(200);
  if (!r.cookie) throw new Error('no cookie');
  return r.cookie;
}

function authenticator(alg?: Alg): Promise<SoftAuthenticator> {
  return SoftAuthenticator.create({ rpId: HOST, origin: ORIGIN, ...(alg ? { alg } : {}) });
}

async function enrol(auth: SoftAuthenticator, cookie: string, knobs: Knobs = {}) {
  const opts = await req<OwnerEnrolOptions>('/auth/owner/enrol/options', { body: {}, cookie });
  expect(opts.status).toBe(200);
  const credential = await auth.register(opts.body.options, knobs);
  return req<OwnerEnrolResult>('/auth/owner/enrol/verify', {
    body: {
      challengeId: opts.body.challengeId,
      credential,
      deviceName: "Urmi's iPhone",
      platform: 'ios',
    },
    cookie,
  });
}

/** Email code, then this phone becomes the key. */
async function enrolled(alg?: Alg) {
  const auth = await authenticator(alg);
  const emailCookie = await emailSignIn();
  const r = await enrol(auth, emailCookie);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  if (!r.cookie) throw new Error('no passkey session');
  return { auth, cookie: r.cookie, device: r.body.device, emailCookie };
}

async function signIn(auth: SoftAuthenticator, knobs: Knobs = {}, o: Opts = {}) {
  const opts = await req<OwnerPasskeyOptions>('/auth/owner/passkey/options', {
    ...o,
    body: { purpose: 'signin' },
  });
  expect(opts.status).toBe(200);
  const credential = await auth.assert(opts.body.options, knobs);
  const r = await req<Me>('/auth/owner/passkey/verify', {
    ...o,
    body: { challengeId: opts.body.challengeId, credential },
  });
  return { ...r, challengeId: opts.body.challengeId, credential };
}

async function sessionRow(cookie: string) {
  return db(
    'SELECT passkey_id, created_at, expires_at, revoked_at FROM sessions WHERE token_hash = ?1',
    await hashToken(cookie),
  ).first<{
    passkey_id: string | null;
    created_at: number;
    expires_at: number;
    revoked_at: number | null;
  }>();
}

async function auditActions(): Promise<string[]> {
  const rows = await db(
    "SELECT action FROM audit_log WHERE entity = 'owner_passkey' ORDER BY created_at, id",
  ).all<{ action: string }>();
  return rows.results.map((r) => r.action);
}

beforeEach(async () => {
  s = await resetScenario('basic-salon');
  now = START;
  email = fakeEmail();
  setServiceOverridesForTests({
    clock: { now: () => now, fake: true },
    email,
    notifier: fakeNotifier(),
  });
});
afterEach(() => setServiceOverridesForTests(null));

describe('PK-1 everything is off unless OWNER_HOST is set', () => {
  const routes: [string, string, unknown][] = [
    ['POST', '/auth/owner/passkey/options', { purpose: 'signin' }],
    ['POST', '/auth/owner/passkey/verify', {}],
    ['POST', '/auth/owner/enrol/options', {}],
    ['POST', '/auth/owner/enrol/verify', {}],
    ['POST', '/auth/owner/device-requests', {}],
    ['POST', `/auth/owner/device-requests/${NO_ID}/status`, {}],
    ['GET', '/owner/device-requests', undefined],
    ['POST', `/owner/device-requests/${NO_ID}/decide`, {}],
    ['GET', '/owner/security/devices', undefined],
    ['PATCH', `/owner/security/devices/${NO_ID}`, {}],
    ['POST', `/owner/security/devices/${NO_ID}/remove`, {}],
    ['POST', '/auth/owner/recovery', {}],
  ];

  it('PK-1.1 the owner access routes answer 404 on the single host, signed in or not', async () => {
    const owner = await sessionFor(s.ownerId, { stepUp: true });
    for (const host of [STAFF_HOST, HOST]) {
      for (const [method, path, body] of routes) {
        for (const cookie of [null, owner]) {
          const r = await req(path, { host, split: false, method, body, cookie });
          expect(r.status, `${method} ${path} on ${host}`).toBe(404);
          expect(r.code).toBe('NOT_FOUND');
        }
      }
    }
  });

  it('PK-1.2 they answer 404 on the staff host when OWNER_HOST is set', async () => {
    for (const [method, path, body] of routes) {
      const r = await req(path, { host: STAFF_HOST, method, body });
      expect(r.status, `${method} ${path}`).toBe(404);
    }
  });

  it('PK-1.4 the owner origin follows APP_ORIGIN, or the request when APP_ORIGIN is empty', () => {
    expect(ownerOrigin({ APP_ORIGIN: 'https://staff.test', OWNER_HOST: HOST })).toBe(ORIGIN);
    expect(
      ownerOrigin({ APP_ORIGIN: 'http://localhost:8787', OWNER_HOST: 'owner.example.test:8787' }),
    ).toBe('http://owner.example.test:8787');
    // The local preview (e2e) leaves APP_ORIGIN empty and serves plain http.
    const preview = { APP_ORIGIN: '', OWNER_HOST: 'owner.example.test:8787' };
    expect(ownerOrigin(preview, new URL('http://owner.example.test:8787/api/v1/me'))).toBe(
      'http://owner.example.test:8787',
    );
    expect(ownerOrigin(preview, new URL('https://owner.example.test:8787/'))).toBe(
      'https://owner.example.test:8787',
    );
    expect(ownerOrigin(preview)).toBe('https://owner.example.test:8787');
  });

  it('PK-1.3 the email code keeps signing in on the single host, even for an owner with a passkey', async () => {
    await db('UPDATE users SET passkey_enrolled_at = ?1 WHERE id = ?2', now, s.ownerId).run();
    const single = { host: STAFF_HOST, split: false } as const;
    const code = await emailCode(single);
    const v = await req<Me>('/auth/owner/verify', { ...single, body: { email: EMAIL, code } });
    expect(v.status).toBe(200);
    expect(v.body.user.role).toBe('owner');
    expect((await req('/me', { ...single, cookie: v.cookie })).status).toBe(200);
    const pw = await req<Me>('/auth/owner/password', {
      ...single,
      body: { email: EMAIL, password: s.owner.password, pin: s.owner.pin },
    });
    expect(pw.status).toBe(200);
  });
});

describe('PK-2 first device: the email code, then "Make this phone your key"', () => {
  it('PK-2.1 the passkey is stored, the owner marked enrolled and the session bound to it', async () => {
    const cookie = await emailSignIn();
    const opts = await req<OwnerEnrolOptions>('/auth/owner/enrol/options', { body: {}, cookie });
    expect(opts.status).toBe(200);
    const o = opts.body.options;
    expect(o.rp).toEqual({ id: HOST, name: 'Feelings' });
    expect(o.user.name).toBe(EMAIL);
    expect(o.attestation).toBe('none');
    expect(o.authenticatorSelection).toMatchObject({
      residentKey: 'preferred',
      userVerification: 'required',
    });
    expect(o.pubKeyCredParams.map((p) => p.alg)).toEqual([-7, -257]);
    expect(o.excludeCredentials).toEqual([]);
    expect(opts.body.expiresAt).toBe(now + 5 * MIN);

    const auth = await authenticator();
    const credential = await auth.register(o);
    const r = await req<OwnerEnrolResult>('/auth/owner/enrol/verify', {
      body: {
        challengeId: opts.body.challengeId,
        credential,
        deviceName: "Urmi's iPhone",
        platform: 'ios',
      },
      cookie,
    });
    expect(r.status).toBe(201);
    expect(r.body.me.user.id).toBe(s.ownerId);
    expect(r.body.device).toMatchObject({
      deviceName: "Urmi's iPhone",
      platform: 'ios',
      createdAt: now,
      lastUsedAt: now,
      current: true,
    });
    const user = await db(
      'SELECT passkey_enrolled_at AS at FROM users WHERE id = ?1',
      s.ownerId,
    ).first<{
      at: number | null;
    }>();
    expect(user?.at).toBe(now);
    const stored = await db(
      'SELECT id, credential_id, sign_count, transports FROM owner_passkeys WHERE user_id = ?1',
      s.ownerId,
    ).all<{ id: string; credential_id: string; sign_count: number; transports: string }>();
    expect(stored.results).toEqual([
      {
        id: r.body.device.id,
        credential_id: auth.id,
        sign_count: 0,
        transports: '["hybrid","internal"]',
      },
    ]);

    if (!r.cookie) throw new Error('no session');
    expect(r.cookie).not.toBe(cookie);
    expect(await sessionRow(r.cookie)).toMatchObject({
      passkey_id: r.body.device.id,
      expires_at: now + 12 * HOUR,
      revoked_at: null,
    });
    // The email-code session ends; the passkey session works.
    expect((await req('/me', { cookie })).status).toBe(401);
    expect((await req('/me', { cookie: r.cookie })).status).toBe(200);
    expect(await auditActions()).toEqual(['owner.passkey_enrolled']);
  });

  it('PK-2.2 an RS256 passkey enrols and signs in too', async () => {
    const { auth } = await enrolled('RS256');
    const r = await signIn(auth);
    expect(r.status).toBe(200);
  });

  it('PK-2.3 the challenge belongs to the session that asked for it', async () => {
    const a = await emailSignIn();
    const b = await emailSignIn();
    const opts = await req<OwnerEnrolOptions>('/auth/owner/enrol/options', { body: {}, cookie: a });
    const auth = await authenticator();
    const credential = await auth.register(opts.body.options);
    const r = await req('/auth/owner/enrol/verify', {
      body: {
        challengeId: opts.body.challengeId,
        credential,
        deviceName: 'Phone',
        platform: 'android',
      },
      cookie: b,
    });
    expect(r.status).toBe(409);
    expect(r.code).toBe('NONCE_INVALID');
  });

  it('PK-2.4 wrong origin, wrong relying party, no user verification or the wrong type are refused', async () => {
    const cookie = await emailSignIn();
    const auth = await authenticator();
    const bad: Knobs[] = [
      { origin: 'https://evil.example.test' },
      { origin: `https://${STAFF_HOST}` },
      { rpId: 'example.test' },
      { noUserVerification: true },
      { type: 'webauthn.get' },
    ];
    for (const knobs of bad) {
      const r = await enrol(auth, cookie, knobs);
      expect(r.status, JSON.stringify(knobs)).toBe(401);
      expect(r.code).toBe('SIGNATURE_INVALID');
    }
    const rows = await db('SELECT COUNT(*) AS n FROM owner_passkeys').first<{ n: number }>();
    expect(rows?.n).toBe(0);
    const user = await db(
      'SELECT passkey_enrolled_at AS at FROM users WHERE id = ?1',
      s.ownerId,
    ).first<{
      at: number | null;
    }>();
    expect(user?.at).toBeNull();
  });

  it('PK-2.5 enrolment needs an owner session; a second first device is refused', async () => {
    expect((await req('/auth/owner/enrol/options', { body: {} })).status).toBe(401);
    const { cookie } = await enrolled();
    const again = await req('/auth/owner/enrol/options', { body: {}, cookie });
    expect(again.status).toBe(422);
    expect(again.reason).toBe('already_enrolled');
    // Another device comes through a device request (owner-devices.test.ts); an unknown token does not.
    const token = await req('/auth/owner/enrol/options', {
      body: { enrolToken: 'A'.repeat(43) },
      cookie,
    });
    expect(token.status).toBe(410);
    expect(token.code).toBe('LINK_EXPIRED');
  });
});

describe('PK-3 passkey sign-in', () => {
  it('PK-3.1 a fingerprint signs in with a session bound to the credential', async () => {
    const before = await req<OwnerPasskeyOptions>('/auth/owner/passkey/options', {
      body: { purpose: 'signin' },
    });
    expect(before.body.emailCode).toBe(true);
    const { auth, device } = await enrolled();

    const opts = await req<OwnerPasskeyOptions>('/auth/owner/passkey/options', {
      body: { purpose: 'signin' },
    });
    expect(opts.status).toBe(200);
    expect(opts.body.emailCode).toBe(false);
    expect(opts.body.options).toMatchObject({
      rpId: HOST,
      userVerification: 'required',
      allowCredentials: [],
    });
    now += 2 * MIN;
    const r = await signIn(auth);
    expect(r.status).toBe(200);
    expect(r.body.user.id).toBe(s.ownerId);
    if (!r.cookie) throw new Error('no session');
    expect(await sessionRow(r.cookie)).toMatchObject({ passkey_id: device.id, created_at: now });
    const pk = await db('SELECT last_used_at FROM owner_passkeys WHERE id = ?1', device.id).first<{
      last_used_at: number;
    }>();
    expect(pk?.last_used_at).toBe(now);
    expect(await auditActions()).toEqual(['owner.passkey_enrolled', 'owner.signin_passkey']);
    const list = await req<OwnerDeviceList>('/owner/security/devices', { cookie: r.cookie });
    expect(list.body.devices.map((d) => [d.id, d.current])).toEqual([[device.id, true]]);
  });

  it('PK-3.2 a replayed answer and a reused challenge are refused', async () => {
    const { auth } = await enrolled();
    const first = await signIn(auth);
    expect(first.status).toBe(200);
    const again = await req('/auth/owner/passkey/verify', {
      body: { challengeId: first.challengeId, credential: first.credential },
    });
    expect(again.status).toBe(409);
    expect(again.code).toBe('NONCE_INVALID');
    const fresh = await req<OwnerPasskeyOptions>('/auth/owner/passkey/options', {
      body: { purpose: 'signin' },
    });
    const replay = await req('/auth/owner/passkey/verify', {
      body: { challengeId: fresh.body.challengeId, credential: first.credential },
    });
    expect(replay.status).toBe(401);
    expect(replay.code).toBe('SIGNATURE_INVALID');
  });

  it('PK-3.3 a challenge older than 5 minutes is refused', async () => {
    const { auth } = await enrolled();
    const opts = await req<OwnerPasskeyOptions>('/auth/owner/passkey/options', {
      body: { purpose: 'signin' },
    });
    const credential = await auth.assert(opts.body.options);
    now += 5 * MIN + 1;
    const r = await req('/auth/owner/passkey/verify', {
      body: { challengeId: opts.body.challengeId, credential },
    });
    expect(r.status).toBe(409);
    expect(r.code).toBe('NONCE_INVALID');
    const unknown = await req('/auth/owner/passkey/verify', {
      body: { challengeId: NO_ID, credential },
    });
    expect(unknown.code).toBe('NONCE_INVALID');
  });

  it('PK-3.4 wrong origin, wrong relying party, no user verification or a wrong challenge are refused', async () => {
    const { auth } = await enrolled();
    const bad: Knobs[] = [
      { origin: 'https://evil.example.test' },
      { origin: `http://${HOST}` },
      { rpId: 'example.test' },
      { noUserVerification: true },
      { challenge: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
      { type: 'webauthn.create' },
    ];
    for (const knobs of bad) {
      const r = await signIn(auth, knobs);
      expect(r.status, JSON.stringify(knobs)).toBe(401);
      expect(r.code).toBe('SIGNATURE_INVALID');
      expect(r.cookie).toBeNull();
    }
    expect((await signIn(auth)).status).toBe(200);
  });

  it('PK-3.5 the counter must grow; counters that stay 0 (synced passkeys) pass', async () => {
    const { auth, device } = await enrolled();
    expect((await signIn(auth)).status).toBe(200);
    expect((await signIn(auth)).status).toBe(200);
    auth.counter = 5;
    expect((await signIn(auth)).status).toBe(200);
    const count = () =>
      db('SELECT sign_count AS n FROM owner_passkeys WHERE id = ?1', device.id).first<{
        n: number;
      }>();
    expect((await count())?.n).toBe(5);
    for (const regressed of [5, 3, 0]) {
      auth.counter = regressed;
      const r = await signIn(auth);
      expect(r.status, `counter ${regressed}`).toBe(401);
      expect(r.code).toBe('SIGNATURE_INVALID');
    }
    auth.counter = 6;
    expect((await signIn(auth)).status).toBe(200);
    expect((await count())?.n).toBe(6);
  });

  it('PK-3.6 an unknown credential is refused', async () => {
    await enrolled();
    const stranger = await authenticator();
    const r = await signIn(stranger);
    expect(r.status).toBe(401);
    expect(r.code).toBe('SIGNATURE_INVALID');
  });

  it('PK-3.7 a removed credential neither signs in nor keeps its sessions', async () => {
    const { auth, cookie, device } = await enrolled();
    expect((await req('/me', { cookie })).status).toBe(200);
    await db(
      'UPDATE owner_passkeys SET removed_at = ?1, removed_by = ?2 WHERE id = ?3',
      now,
      s.ownerId,
      device.id,
    ).run();
    expect((await req('/me', { cookie })).status).toBe(401);
    const r = await signIn(auth);
    expect(r.status).toBe(401);
    expect(r.code).toBe('SIGNATURE_INVALID');
  });

  it('PK-3.8 a passkey session ends after 12 idle hours', async () => {
    const { cookie } = await enrolled();
    now += 11 * HOUR;
    expect((await req('/me', { cookie })).status).toBe(200);
    now += 11 * HOUR;
    expect((await req('/me', { cookie })).status).toBe(200);
    now += 12 * HOUR + 1;
    expect((await req('/me', { cookie })).status).toBe(401);
  });

  it('PK-3.9 and after 7 days however active it is', async () => {
    const { cookie } = await enrolled();
    for (let i = 0; i < 15; i++) {
      now += 11 * HOUR;
      expect((await req('/me', { cookie })).status, `after ${(i + 1) * 11} h`).toBe(200);
    }
    now += 11 * HOUR;
    expect((await req('/me', { cookie })).status).toBe(401);
  });

  it('PK-3.10 on the owner host an owner with a passkey has no other kind of session', async () => {
    await enrolled();
    const legacy = await sessionFor(s.ownerId);
    expect((await req('/me', { cookie: legacy })).status).toBe(401);
    const other = await sessionFor(s.ownerId);
    expect((await req('/me', { cookie: other, host: STAFF_HOST, split: false })).status).toBe(200);
  });

  it('PK-3.11 a passkey sign-in opens the forgotten-PIN window like the email code (flow 6)', async () => {
    const { auth } = await enrolled();
    now += 2 * MIN;
    const r = await signIn(auth);
    if (!r.cookie) throw new Error('no session');
    const view = await req<{ pinResetUntil?: number | null }>('/owner/security', {
      cookie: r.cookie,
    });
    expect(view.body.pinResetUntil).toBe(now + 15 * MIN);
    const reset = await req('/owner/security/pin', {
      cookie: r.cookie,
      method: 'PUT',
      body: { pin: '739164' },
    });
    expect(reset.status).toBe(200);
    const audit = await db(
      "SELECT action FROM audit_log WHERE entity = 'user' AND entity_id = ?1",
      s.ownerId,
    ).all<{ action: string }>();
    expect(audit.results.map((r) => r.action)).toContain('owner.pin_reset');
    const again = await req('/owner/security/pin', {
      cookie: r.cookie,
      method: 'PUT',
      body: { pin: '518206' },
    });
    expect(again.reason).toBe('recent_sign_in_required');
  });
});

describe('PK-4 no email code after the first device', () => {
  it('PK-4.1 the owner host sends no code and refuses one sent elsewhere', async () => {
    await enrolled();
    const sent = email.sent.length;
    const m = await req('/auth/owner/magic', { body: { email: EMAIL } });
    expect(m.status).toBe(202);
    expect(email.sent.length).toBe(sent);
    const code = await emailCode({ host: STAFF_HOST, split: false });
    const v = await req('/auth/owner/verify', { body: { email: EMAIL, code } });
    expect(v.status).toBe(403);
    expect(v.code).toBe('FORBIDDEN');
    expect(v.reason).toBe('passkey_enrolled');
    expect(v.cookie).toBeNull();
  });

  it('PK-4.2 a code sent before the enrolment stops working', async () => {
    const auth = await authenticator();
    const cookie = await emailSignIn();
    const spare = await emailCode();
    expect((await enrol(auth, cookie)).status).toBe(201);
    const v = await req('/auth/owner/verify', { body: { email: EMAIL, code: spare } });
    expect(v.status).toBe(410);
    expect(v.code).toBe('LINK_EXPIRED');
  });

  it('PK-4.3 the password and PIN no longer sign in on the owner host', async () => {
    await enrolled();
    const r = await req('/auth/owner/password', {
      body: { email: EMAIL, password: s.owner.password, pin: s.owner.pin },
    });
    expect(r.status).toBe(403);
    expect(r.reason).toBe('passkey_enrolled');
  });
});

describe('PK-5 confirm challenges and the device list', () => {
  it('PK-5.1 a confirm challenge needs a passkey session and allows only its credential', async () => {
    expect(
      (await req('/auth/owner/passkey/options', { body: { purpose: 'confirm' } })).status,
    ).toBe(401);
    const emailCookie = await emailSignIn();
    const no = await req('/auth/owner/passkey/options', {
      body: { purpose: 'confirm' },
      cookie: emailCookie,
    });
    expect(no.status).toBe(403);
    expect(no.reason).toBe('passkey_session');
    const auth = await authenticator();
    const done = await enrol(auth, emailCookie);
    const ok = await req<OwnerPasskeyOptions>('/auth/owner/passkey/options', {
      body: { purpose: 'confirm' },
      cookie: done.cookie,
    });
    expect(ok.status).toBe(200);
    expect(ok.body.options.allowCredentials).toEqual([
      { id: auth.id, type: 'public-key', transports: ['hybrid', 'internal'] },
    ]);
    // A confirm challenge cannot be used to sign in.
    const credential = await auth.assert(ok.body.options);
    const r = await req('/auth/owner/passkey/verify', {
      body: { challengeId: ok.body.challengeId, credential },
    });
    expect(r.status).toBe(409);
  });

  it('PK-5.2 the device list shows this device and rename is audited', async () => {
    const { cookie, device } = await enrolled();
    const list = await req<OwnerDeviceList>('/owner/security/devices', { cookie });
    expect(list.status).toBe(200);
    expect(list.body.devices).toEqual([device]);
    const renamed = await req<OwnerDeviceView>(`/owner/security/devices/${device.id}`, {
      method: 'PATCH',
      body: { deviceName: "  Urmi's work phone " },
      cookie,
    });
    expect(renamed.status).toBe(200);
    expect(renamed.body.deviceName).toBe("Urmi's work phone");
    expect(await auditActions()).toEqual(['owner.passkey_enrolled', 'owner.device_renamed']);
    const missing = await req(`/owner/security/devices/${NO_ID}`, {
      method: 'PATCH',
      body: { deviceName: 'x' },
      cookie,
    });
    expect(missing.status).toBe(404);
  });
});

describe('PK-6 rate limits', () => {
  it('PK-6.1 20 challenges per IP in 15 minutes, then 429', async () => {
    const ask = (ip: string) =>
      req('/auth/owner/passkey/options', { body: { purpose: 'signin' }, ip });
    for (let i = 0; i < 20; i++) expect((await ask('203.0.113.7')).status).toBe(200);
    const blocked = await ask('203.0.113.7');
    expect(blocked.status).toBe(429);
    expect(blocked.code).toBe('RATE_LIMITED');
    expect((await ask('198.51.100.4')).status).toBe(200);
    now += 15 * MIN + 1;
    expect((await ask('203.0.113.7')).status).toBe(200);
  });
});

describe('PK-7 retention', () => {
  it('PK-7.1 the nightly purge drops old challenges, requests, recovery codes and removed passkeys', async () => {
    const at = START + 40 * DAY;
    const old = (days: number) => at - days * DAY;
    const org = s.orgId;
    await testEnv.DB.batch([
      db(
        `INSERT INTO owner_passkey_challenges (id, org_id, purpose, challenge, expires_at, created_at)
         VALUES ('CH-old', ?1, 'signin', 'c1', ?2, ?2), ('CH-new', ?1, 'signin', 'c2', ?3, ?3)`,
        org,
        old(8),
        old(1),
      ),
      db(
        `INSERT INTO owner_device_requests (id, org_id, code, device_name, platform, status, enrol_token_hash, expires_at, created_at)
         VALUES ('DR-old', ?1, '111111', 'x', 'ios', 'expired', 'h1', ?2, ?2), ('DR-new', ?1, '222222', 'x', 'ios', 'pending', 'h2', ?3, ?3)`,
        org,
        old(31),
        old(1),
      ),
      db(
        `INSERT INTO owner_recovery_codes (id, org_id, user_id, code_hash, issued_by, expires_at, created_at)
         VALUES ('RC-old', ?1, ?2, 'r1', 'admin', ?3, ?3), ('RC-new', ?1, ?2, 'r2', 'admin', ?4, ?4)`,
        org,
        s.ownerId,
        old(31),
        old(1),
      ),
      db(
        `INSERT INTO owner_passkeys (id, org_id, user_id, credential_id, public_key, device_name, platform, created_at, removed_at)
         VALUES ('PK-old', ?1, ?2, 'cred-old', 'k', 'x', 'ios', ?3, ?3), ('PK-kept', ?1, ?2, 'cred-kept', 'k', 'x', 'ios', ?4, ?4),
                ('PK-live', ?1, ?2, 'cred-live', 'k', 'x', 'ios', ?3, NULL)`,
        org,
        s.ownerId,
        old(400),
        old(30),
      ),
    ]);
    await runJob('nightly', testEnv, at);
    const ids = async (table: string) =>
      (await db(`SELECT id FROM ${table} ORDER BY id`).all<{ id: string }>()).results.map(
        (r) => r.id,
      );
    expect(await ids('owner_passkey_challenges')).toEqual(['CH-new']);
    expect(await ids('owner_device_requests')).toEqual(['DR-new']);
    expect(await ids('owner_recovery_codes')).toEqual(['RC-new']);
    expect(await ids('owner_passkeys')).toEqual(['PK-kept', 'PK-live']);
  });
});
