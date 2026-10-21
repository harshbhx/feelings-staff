/**
 * Owner devices, slice 5 (docs/owner-access.md "Passkeys" flow 3, ADR-19): "Add this device" on a new
 * device, the approval card on an approved device (fingerprint on that device plus the owner PIN), the
 * single-use enrolment token, expiry and decline, and the replays: token reuse, an expired or declined
 * request, a wrong token ("code"), and an answer from a removed credential. The browser side is the
 * software authenticator in test/webauthn.ts. SD-1 (slice 6): the device list and Remove in Settings,
 * Security (flow 4): fingerprint plus PIN, never the last device, the removed device signed out.
 */
import type {
  Me,
  OwnerDeviceList,
  OwnerDeviceRequestCreated,
  OwnerDeviceRequestList,
  OwnerDeviceRequestState,
  OwnerDeviceRequestView,
  OwnerEnrolOptions,
  OwnerEnrolResult,
  OwnerPasskeyOptions,
} from '@fs/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../index';
import { setServiceOverridesForTests } from '../../services/registry';
import { fakeEmail, fakeNotifier } from '../../test/fakes';
import { resetScenario, type Scenario, sessionFor, testEnv } from '../../test/helpers';
import { cookieFrom } from './test/kit';
import { SoftAuthenticator } from './test/webauthn';

const HOST = 'owner.example.test';
const ORIGIN = `https://${HOST}`;
const EMAIL = 'owner@feelings.test';
const START = Date.parse('2026-10-19T10:42:00+05:30');
const MIN = 60_000;
const NO_ID = '01JBZZZZZZZZZZZZZZZZZZZZZZ';

let s: Scenario;
let now = START;
let email: ReturnType<typeof fakeEmail>;

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
  ip?: string;
  method?: string;
  city?: string;
}

interface Res<T> {
  status: number;
  body: T;
  cookie: string | null;
  code: string | undefined;
  reason: unknown;
}

/** One request to the owner host (OWNER_HOST set). */
async function req<T = unknown>(path: string, o: Opts = {}): Promise<Res<T>> {
  const env = { ...testEnv, OWNER_HOST: HOST };
  const headers: Record<string, string> = { Origin: ORIGIN, 'X-FS-Client': '0.1.0' };
  if (o.cookie) headers.Cookie = `fs_session=${o.cookie}`;
  if (o.ip) headers['CF-Connecting-IP'] = o.ip;
  let body: string | undefined;
  if (o.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(o.body);
  }
  const method = o.method ?? (o.body !== undefined ? 'POST' : 'GET');
  // `cf` is what Cloudflare adds to a real request (here only the city, for the approval card).
  const init = {
    method,
    headers,
    ...(body ? { body } : {}),
    ...(o.city ? { cf: { city: o.city } } : {}),
  } as RequestInit;
  const res = await createApp().fetch(new Request(`${ORIGIN}/api/v1${path}`, init), env, execCtx);
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

function authenticator(): Promise<SoftAuthenticator> {
  return SoftAuthenticator.create({ rpId: HOST, origin: ORIGIN });
}

/** The first device: the email code, then this phone becomes the key. Returns its passkey session. */
async function firstDevice() {
  const before = email.sent.length;
  expect((await req('/auth/owner/magic', { body: { email: EMAIL } })).status).toBe(202);
  expect(email.sent.length).toBe(before + 1);
  const code = email.sent.at(-1)?.subject.match(/(\d{6})$/)?.[1];
  const v = await req<Me>('/auth/owner/verify', { body: { email: EMAIL, code } });
  expect(v.status).toBe(200);
  const auth = await authenticator();
  const opts = await req<OwnerEnrolOptions>('/auth/owner/enrol/options', {
    body: {},
    cookie: v.cookie,
  });
  const r = await req<OwnerEnrolResult>('/auth/owner/enrol/verify', {
    body: {
      challengeId: opts.body.challengeId,
      credential: await auth.register(opts.body.options),
      deviceName: "Urmi's iPhone",
      platform: 'ios',
    },
    cookie: v.cookie,
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  if (!r.cookie) throw new Error('no passkey session');
  return { auth, cookie: r.cookie, device: r.body.device };
}

/** "Add this device" on a new device. */
async function ask(o: Opts = {}) {
  const r = await req<OwnerDeviceRequestCreated>('/auth/owner/device-requests', {
    ...o,
    body: { deviceName: "Urmi's laptop", platform: 'desktop' },
  });
  return r;
}

async function poll(id: string, enrolToken: string) {
  return req<OwnerDeviceRequestState>(`/auth/owner/device-requests/${id}/status`, {
    body: { enrolToken },
  });
}

/** The owner PIN on this session (step-up, 10 minutes). */
async function pin(cookie: string) {
  const r = await req('/auth/step-up', { body: { pin: s.owner.pin }, cookie });
  expect(r.status).toBe(200);
}

/** A fingerprint on the approving device: a confirm challenge and this authenticator's answer. */
async function confirm(cookie: string, auth: SoftAuthenticator) {
  const opts = await req<OwnerPasskeyOptions>('/auth/owner/passkey/options', {
    body: { purpose: 'confirm' },
    cookie,
  });
  expect(opts.status).toBe(200);
  return { challengeId: opts.body.challengeId, credential: await auth.assert(opts.body.options) };
}

function approve(id: string, cookie: string, answer: { challengeId: string; credential: unknown }) {
  return req<OwnerDeviceRequestView>(`/owner/device-requests/${id}/decide`, {
    body: { decision: 'approve', ...answer },
    cookie,
  });
}

function decline(id: string, cookie: string) {
  return req<OwnerDeviceRequestView>(`/owner/device-requests/${id}/decide`, {
    body: { decision: 'decline' },
    cookie,
  });
}

/** The new device creates its passkey with the token. */
async function enrolWithToken(
  enrolToken: string,
  auth: SoftAuthenticator,
): Promise<Res<OwnerEnrolResult> & { options: OwnerEnrolOptions['options'] | null }> {
  const opts = await req<OwnerEnrolOptions>('/auth/owner/enrol/options', {
    body: { enrolToken },
  });
  // Refused at the options step: the status and code are what the tests look at.
  if (opts.status !== 200) return { ...(opts as unknown as Res<OwnerEnrolResult>), options: null };
  const r = await req<OwnerEnrolResult>('/auth/owner/enrol/verify', {
    body: {
      challengeId: opts.body.challengeId,
      credential: await auth.register(opts.body.options),
      deviceName: "Urmi's laptop",
      platform: 'desktop',
      enrolToken,
    },
  });
  return { ...r, options: opts.body.options };
}

/** First device, a request from a new device, approved with fingerprint and PIN. */
async function approvedRequest() {
  const first = await firstDevice();
  const asked = await ask();
  expect(asked.status).toBe(201);
  await pin(first.cookie);
  const ok = await approve(asked.body.id, first.cookie, await confirm(first.cookie, first.auth));
  expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  return { first, request: asked.body };
}

async function requestRow(id: string) {
  return db(
    `SELECT status, user_id, approved_by_credential, enrol_token_hash, decided_at, used_at, city
       FROM owner_device_requests WHERE id = ?1`,
    id,
  ).first<{
    status: string;
    user_id: string | null;
    approved_by_credential: string | null;
    enrol_token_hash: string;
    decided_at: number | null;
    used_at: number | null;
    city: string | null;
  }>();
}

async function audit(entity: string) {
  const rows = await db(
    'SELECT action, after_json FROM audit_log WHERE entity = ?1 ORDER BY created_at, id',
    entity,
  ).all<{ action: string; after_json: string | null }>();
  return rows.results;
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

describe('DA-1 "Add this device" on the new device', () => {
  it('DA-1.1 a request has a 6-digit code, 15 minutes and a token the server keeps only hashed', async () => {
    await firstDevice();
    const r = await ask({ city: 'Rajkot' });
    expect(r.status).toBe(201);
    expect(r.body.code).toMatch(/^\d{6}$/);
    expect(r.body.expiresAt).toBe(START + 15 * MIN);
    expect(r.body.enrolToken.length).toBeGreaterThanOrEqual(32);
    const row = await requestRow(r.body.id);
    expect(row?.status).toBe('pending');
    expect(row?.user_id).toBeNull();
    expect(row?.city).toBe('Rajkot');
    expect(row?.enrol_token_hash).not.toContain(r.body.enrolToken);
    const raw = await db('SELECT * FROM owner_device_requests').all();
    expect(JSON.stringify(raw.results)).not.toContain(r.body.enrolToken);
    const rows = await audit('owner_device_request');
    expect(rows.map((x) => x.action)).toEqual(['owner.device_requested']);
    expect(rows[0]?.after_json).not.toContain(r.body.enrolToken);

    const state = await poll(r.body.id, r.body.enrolToken);
    expect(state.status).toBe(200);
    expect(state.body).toEqual({
      id: r.body.id,
      status: 'pending',
      expiresAt: START + 15 * MIN,
      enrolUntil: null,
    });
  });

  it('DA-1.2 with no passkey anywhere yet there is nobody to approve it', async () => {
    const r = await ask();
    expect(r.status).toBe(422);
    expect(r.reason).toBe('no_device');
  });

  it('DA-1.3 a wrong token, or the token of another request, finds nothing', async () => {
    await firstDevice();
    const a = await ask();
    const b = await ask();
    expect((await poll(a.body.id, 'A'.repeat(43))).status).toBe(404);
    expect((await poll(a.body.id, b.body.enrolToken)).status).toBe(404);
    expect((await poll(NO_ID, a.body.enrolToken)).status).toBe(404);
    expect((await poll(a.body.id, a.body.enrolToken)).status).toBe(200);
  });

  it('DA-1.4 5 requests per IP in 15 minutes, then 429', async () => {
    await firstDevice();
    for (let i = 0; i < 5; i++) expect((await ask({ ip: '203.0.113.7' })).status).toBe(201);
    const blocked = await ask({ ip: '203.0.113.7' });
    expect(blocked.status).toBe(429);
    expect(blocked.code).toBe('RATE_LIMITED');
    expect((await ask({ ip: '198.51.100.4' })).status).toBe(201);
    now += 15 * MIN + 1;
    expect((await ask({ ip: '203.0.113.7' })).status).toBe(201);
  });
});

describe('DA-2 the approval card on an approved device', () => {
  it('DA-2.1 pending requests are listed newest first, on a passkey session only', async () => {
    const first = await firstDevice();
    const a = await ask();
    now += MIN;
    const b = await ask();
    const list = await req<OwnerDeviceRequestList>('/owner/device-requests', {
      cookie: first.cookie,
    });
    expect(list.status).toBe(200);
    expect(list.body.requests.map((r) => r.id)).toEqual([b.body.id, a.body.id]);
    expect(list.body.requests[0]).toMatchObject({
      code: b.body.code,
      deviceName: "Urmi's laptop",
      platform: 'desktop',
      status: 'pending',
      expiresAt: START + MIN + 15 * MIN,
    });
    expect(JSON.stringify(list.body)).not.toContain(b.body.enrolToken);
    // No session, and a session that did not sign in with a passkey, see nothing.
    expect((await req('/owner/device-requests')).status).toBe(401);
    await db('UPDATE users SET passkey_enrolled_at = NULL WHERE id = ?1', s.ownerId).run();
    const plain = await sessionFor(s.ownerId, { stepUp: true });
    const no = await req('/owner/device-requests', { cookie: plain });
    expect(no.status).toBe(403);
    expect(no.reason).toBe('passkey_session');
    expect((await decline(a.body.id, plain)).reason).toBe('passkey_session');
  });

  it('DA-2.2 approve takes the fingerprint on this device and the owner PIN', async () => {
    const first = await firstDevice();
    const asked = await ask();
    const answer = await confirm(first.cookie, first.auth);
    // Without the PIN: step-up first, and the fingerprint is not used up.
    const noPin = await approve(asked.body.id, first.cookie, answer);
    expect(noPin.status).toBe(403);
    expect(noPin.code).toBe('STEP_UP_REQUIRED');
    expect((await requestRow(asked.body.id))?.status).toBe('pending');
    await pin(first.cookie);
    now += MIN;
    const ok = await approve(asked.body.id, first.cookie, answer);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ id: asked.body.id, status: 'approved' });
    const row = await requestRow(asked.body.id);
    expect(row).toMatchObject({
      status: 'approved',
      user_id: s.ownerId,
      approved_by_credential: first.device.id,
      decided_at: START + MIN,
      used_at: null,
    });
    const state = await poll(asked.body.id, asked.body.enrolToken);
    expect(state.body).toMatchObject({ status: 'approved', enrolUntil: START + 11 * MIN });
    const list = await req<OwnerDeviceRequestList>('/owner/device-requests', {
      cookie: first.cookie,
    });
    expect(list.body.requests).toEqual([]);
    expect((await audit('owner_device_request')).map((x) => x.action)).toEqual([
      'owner.device_requested',
      'owner.device_approved',
    ]);
    // The approving passkey was used just now.
    const used = await db(
      'SELECT last_used_at FROM owner_passkeys WHERE id = ?1',
      first.device.id,
    ).first<{ last_used_at: number }>();
    expect(used?.last_used_at).toBe(START + MIN);
    // Deciding again is refused.
    const again = await approve(
      asked.body.id,
      first.cookie,
      await confirm(first.cookie, first.auth),
    );
    expect(again.status).toBe(409);
    expect(again.code).toBe('ALREADY_DECIDED');
  });

  it('DA-2.3 the fingerprint must answer a fresh confirm challenge of this session', async () => {
    const first = await firstDevice();
    const asked = await ask();
    await pin(first.cookie);
    // A sign-in challenge does not approve.
    const signin = await req<OwnerPasskeyOptions>('/auth/owner/passkey/options', {
      body: { purpose: 'signin' },
    });
    const viaSignin = await approve(asked.body.id, first.cookie, {
      challengeId: signin.body.challengeId,
      credential: await first.auth.assert(signin.body.options),
    });
    expect(viaSignin.status).toBe(409);
    expect(viaSignin.code).toBe('NONCE_INVALID');
    // A challenge answered once is used up.
    const answer = await confirm(first.cookie, first.auth);
    expect((await decline(NO_ID, first.cookie)).status).toBe(404);
    const late = { ...answer };
    now += 5 * MIN + 1;
    expect((await approve(asked.body.id, first.cookie, late)).code).toBe('NONCE_INVALID');
    now = START + 6 * MIN;
    const fresh = await confirm(first.cookie, first.auth);
    await pin(first.cookie);
    expect((await approve(asked.body.id, first.cookie, fresh)).status).toBe(200);
    expect((await approve(asked.body.id, first.cookie, fresh)).code).toBe('ALREADY_DECIDED');
    // An answer with no user verification is refused.
    const other = await ask();
    const noUv = await req<OwnerPasskeyOptions>('/auth/owner/passkey/options', {
      body: { purpose: 'confirm' },
      cookie: first.cookie,
    });
    const r = await approve(other.body.id, first.cookie, {
      challengeId: noUv.body.challengeId,
      credential: await first.auth.assert(noUv.body.options, { noUserVerification: true }),
    });
    expect(r.status).toBe(401);
    expect(r.code).toBe('SIGNATURE_INVALID');
    expect((await requestRow(other.body.id))?.status).toBe('pending');
  });

  it('DA-2.4 an answer from a removed credential neither approves nor keeps its session', async () => {
    const { first, request } = await approvedRequest();
    const laptop = await authenticator();
    const enrolled = await enrolWithToken(request.enrolToken, laptop);
    expect(enrolled.status).toBe(201);
    const laptopCookie = enrolled.cookie;
    // The laptop's passkey is removed (Remove comes in the next slice; the row is what counts).
    await db(
      'UPDATE owner_passkeys SET removed_at = ?1, removed_by = ?2 WHERE id = ?3',
      now,
      s.ownerId,
      enrolled.body.device.id,
    ).run();
    expect((await req('/owner/device-requests', { cookie: laptopCookie })).status).toBe(401);
    // The phone's confirm challenge answered by the removed laptop passkey is refused.
    const next = await ask();
    const opts = await req<OwnerPasskeyOptions>('/auth/owner/passkey/options', {
      body: { purpose: 'confirm' },
      cookie: first.cookie,
    });
    await pin(first.cookie);
    const r = await approve(next.body.id, first.cookie, {
      challengeId: opts.body.challengeId,
      credential: await laptop.assert(opts.body.options),
    });
    expect(r.status).toBe(401);
    expect(r.code).toBe('SIGNATURE_INVALID');
    expect((await requestRow(next.body.id))?.status).toBe('pending');
  });

  it('DA-2.5 decline: audited, the new device is told, the token never enrols', async () => {
    const first = await firstDevice();
    const asked = await ask();
    // Decline needs the PIN too (step-up), but no fingerprint.
    expect((await decline(asked.body.id, first.cookie)).code).toBe('STEP_UP_REQUIRED');
    await pin(first.cookie);
    const r = await decline(asked.body.id, first.cookie);
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('declined');
    expect((await requestRow(asked.body.id))?.status).toBe('declined');
    expect((await poll(asked.body.id, asked.body.enrolToken)).body.status).toBe('declined');
    const enrol = await enrolWithToken(asked.body.enrolToken, await authenticator());
    expect(enrol.status).toBe(410);
    expect(enrol.code).toBe('LINK_EXPIRED');
    const approveLater = await approve(
      asked.body.id,
      first.cookie,
      await confirm(first.cookie, first.auth),
    );
    expect(approveLater.code).toBe('ALREADY_DECIDED');
    expect((await decline(asked.body.id, first.cookie)).code).toBe('ALREADY_DECIDED');
    expect((await audit('owner_device_request')).map((x) => x.action)).toEqual([
      'owner.device_requested',
      'owner.device_declined',
    ]);
  });

  it('DA-2.6 a request expires after 15 minutes', async () => {
    const first = await firstDevice();
    const asked = await ask();
    now += 15 * MIN;
    expect((await poll(asked.body.id, asked.body.enrolToken)).body.status).toBe('expired');
    const list = await req<OwnerDeviceRequestList>('/owner/device-requests', {
      cookie: first.cookie,
    });
    expect(list.body.requests).toEqual([]);
    await pin(first.cookie);
    const r = await approve(asked.body.id, first.cookie, await confirm(first.cookie, first.auth));
    expect(r.status).toBe(410);
    expect(r.code).toBe('LINK_EXPIRED');
    expect((await requestRow(asked.body.id))?.status).toBe('expired');
    expect((await decline(asked.body.id, first.cookie)).code).toBe('LINK_EXPIRED');
    expect((await enrolWithToken(asked.body.enrolToken, await authenticator())).status).toBe(410);
  });
});

describe('DA-3 the new device creates its passkey with the token', () => {
  it('DA-3.1 after approval the token enrols once, for the approving owner, with a bound session', async () => {
    const { first, request } = await approvedRequest();
    const laptop = await authenticator();
    now += 2 * MIN;
    const r = await enrolWithToken(request.enrolToken, laptop);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    // The new passkey cannot be the one the phone already holds.
    expect(r.options?.excludeCredentials?.map((c) => c.id)).toEqual([first.auth.id]);
    expect(r.body.me.user.id).toBe(s.ownerId);
    expect(r.body.device).toMatchObject({
      deviceName: "Urmi's laptop",
      platform: 'desktop',
      current: true,
    });
    if (!r.cookie) throw new Error('no session');
    const session = await db(
      'SELECT passkey_id FROM sessions WHERE passkey_id = ?1',
      r.body.device.id,
    ).first<{ passkey_id: string }>();
    expect(session?.passkey_id).toBe(r.body.device.id);
    expect((await requestRow(request.id))?.used_at).toBe(START + 2 * MIN);
    const list = await req<OwnerDeviceList>('/owner/security/devices', { cookie: r.cookie });
    expect(list.body.devices.map((d) => [d.deviceName, d.current])).toEqual([
      ["Urmi's iPhone", false],
      ["Urmi's laptop", true],
    ]);
    // The phone keeps its session, and the laptop signs in with its own passkey from now on.
    expect((await req('/me', { cookie: first.cookie })).status).toBe(200);
    const opts = await req<OwnerPasskeyOptions>('/auth/owner/passkey/options', {
      body: { purpose: 'signin' },
    });
    const signIn = await req<Me>('/auth/owner/passkey/verify', {
      body: {
        challengeId: opts.body.challengeId,
        credential: await laptop.assert(opts.body.options),
      },
    });
    expect(signIn.status).toBe(200);
    const rows = await audit('owner_passkey');
    expect(rows.map((x) => x.action)).toEqual([
      'owner.passkey_enrolled',
      'owner.passkey_enrolled',
      'owner.signin_passkey',
    ]);
    expect(JSON.parse(rows[1]?.after_json ?? '{}')).toMatchObject({
      via: 'device_request',
      requestId: request.id,
    });
  });

  it('DA-3.2 a pending request does not enrol yet', async () => {
    await firstDevice();
    const asked = await ask();
    const r = await enrolWithToken(asked.body.enrolToken, await authenticator());
    expect(r.status).toBe(410);
    expect(r.code).toBe('LINK_EXPIRED');
  });

  it('DA-3.3 a used token is refused: a second passkey, a second options call, the poll', async () => {
    const { request } = await approvedRequest();
    // Two challenges with the same token: only the first passkey is saved.
    const optsA = await req<OwnerEnrolOptions>('/auth/owner/enrol/options', {
      body: { enrolToken: request.enrolToken },
    });
    const optsB = await req<OwnerEnrolOptions>('/auth/owner/enrol/options', {
      body: { enrolToken: request.enrolToken },
    });
    const verify = async (opts: OwnerEnrolOptions) =>
      req<OwnerEnrolResult>('/auth/owner/enrol/verify', {
        body: {
          challengeId: opts.challengeId,
          credential: await (await authenticator()).register(opts.options),
          deviceName: 'Laptop',
          platform: 'desktop',
          enrolToken: request.enrolToken,
        },
      });
    expect((await verify(optsA.body)).status).toBe(201);
    const second = await verify(optsB.body);
    expect(second.status).toBe(410);
    expect(second.code).toBe('LINK_EXPIRED');
    const count = await db(
      'SELECT COUNT(*) AS n FROM owner_passkeys WHERE removed_at IS NULL',
    ).first<{ n: number }>();
    expect(count?.n).toBe(2);
    expect((await enrolWithToken(request.enrolToken, await authenticator())).status).toBe(410);
    const state = await poll(request.id, request.enrolToken);
    expect(state.status).toBe(410);
    expect(state.code).toBe('LINK_EXPIRED');
  });

  it('DA-3.4 the token works for 10 minutes after approval', async () => {
    const { request } = await approvedRequest();
    now += 10 * MIN;
    expect((await poll(request.id, request.enrolToken)).body.status).toBe('expired');
    const r = await enrolWithToken(request.enrolToken, await authenticator());
    expect(r.status).toBe(410);
    expect(r.code).toBe('LINK_EXPIRED');
  });

  it('DA-3.5 the enrol challenge belongs to its request', async () => {
    const { first, request } = await approvedRequest();
    const other = await ask();
    await pin(first.cookie);
    await approve(other.body.id, first.cookie, await confirm(first.cookie, first.auth));
    const opts = await req<OwnerEnrolOptions>('/auth/owner/enrol/options', {
      body: { enrolToken: request.enrolToken },
    });
    const r = await req('/auth/owner/enrol/verify', {
      body: {
        challengeId: opts.body.challengeId,
        credential: await (await authenticator()).register(opts.body.options),
        deviceName: 'Laptop',
        platform: 'desktop',
        enrolToken: other.body.enrolToken,
      },
    });
    expect(r.status).toBe(409);
    expect(r.code).toBe('NONCE_INVALID');
    // Neither token was used up by the refused try.
    expect((await requestRow(request.id))?.used_at).toBeNull();
    expect((await requestRow(other.body.id))?.used_at).toBeNull();
  });
});

describe('SD-1 Settings, Security: the device list and Remove (slice 6)', () => {
  /** The phone, and a laptop approved and enrolled a minute later; both have a passkey session. */
  async function twoDevices() {
    const { first, request } = await approvedRequest();
    now += MIN;
    const auth = await authenticator();
    const r = await enrolWithToken(request.enrolToken, auth);
    expect(r.status).toBe(201);
    if (!r.cookie) throw new Error('no laptop session');
    return { phone: first, laptop: { auth, cookie: r.cookie, device: r.body.device } };
  }

  function remove(
    id: string,
    cookie: string,
    answer: { challengeId: string; credential: unknown },
  ) {
    return req<OwnerDeviceList>(`/owner/security/devices/${id}/remove`, { body: answer, cookie });
  }

  it('SD-1.1 every approved device: name, platform, added, last used, "This device"', async () => {
    const { phone, laptop } = await twoDevices();
    const list = await req<OwnerDeviceList>('/owner/security/devices', { cookie: phone.cookie });
    expect(list.status).toBe(200);
    expect(list.body.devices).toEqual([
      {
        id: phone.device.id,
        deviceName: "Urmi's iPhone",
        platform: 'ios',
        createdAt: START,
        lastUsedAt: START,
        current: true,
      },
      {
        id: laptop.device.id,
        deviceName: "Urmi's laptop",
        platform: 'desktop',
        createdAt: START + MIN,
        lastUsedAt: START + MIN,
        current: false,
      },
    ]);
    const fromLaptop = await req<OwnerDeviceList>('/owner/security/devices', {
      cookie: laptop.cookie,
    });
    expect(fromLaptop.body.devices.map((d) => d.current)).toEqual([false, true]);
  });

  it('SD-1.2 Remove takes the fingerprint on this device and the PIN, and signs that device out', async () => {
    const { phone, laptop } = await twoDevices();
    now = START + 11 * MIN;
    const answer = await confirm(phone.cookie, phone.auth);
    const noPin = await remove(laptop.device.id, phone.cookie, answer);
    expect(noPin.code).toBe('STEP_UP_REQUIRED');
    await pin(phone.cookie);
    const r = await remove(laptop.device.id, phone.cookie, answer);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.devices.map((d) => [d.id, d.current])).toEqual([[phone.device.id, true]]);
    const row = await db(
      'SELECT removed_at, removed_by FROM owner_passkeys WHERE id = ?1',
      laptop.device.id,
    ).first<{ removed_at: number; removed_by: string }>();
    expect(row).toEqual({ removed_at: START + 11 * MIN, removed_by: s.ownerId });
    const sessions = await db(
      'SELECT revoked_at FROM sessions WHERE passkey_id = ?1',
      laptop.device.id,
    ).all<{ revoked_at: number | null }>();
    expect(sessions.results.map((x) => x.revoked_at)).toEqual([START + 11 * MIN]);
    expect((await req('/me', { cookie: laptop.cookie })).status).toBe(401);
    expect((await req('/me', { cookie: phone.cookie })).status).toBe(200);
    // The removed passkey no longer signs in.
    const opts = await req<OwnerPasskeyOptions>('/auth/owner/passkey/options', {
      body: { purpose: 'signin' },
    });
    const signIn = await req('/auth/owner/passkey/verify', {
      body: {
        challengeId: opts.body.challengeId,
        credential: await laptop.auth.assert(opts.body.options),
      },
    });
    expect(signIn.status).toBe(401);
    const rows = await audit('owner_passkey');
    expect(rows.map((x) => x.action).at(-1)).toBe('owner.device_removed');
    expect(rows.at(-1)?.after_json).toContain("Urmi's iPhone");
  });

  it('SD-1.3 the last device cannot be removed, and the fingerprint is not used up', async () => {
    const first = await firstDevice();
    await pin(first.cookie);
    const answer = await confirm(first.cookie, first.auth);
    const r = await remove(first.device.id, first.cookie, answer);
    expect(r.status).toBe(422);
    expect(r.reason).toBe('last_device');
    const challenge = await db(
      'SELECT used_at FROM owner_passkey_challenges WHERE id = ?1',
      answer.challengeId,
    ).first<{ used_at: number | null }>();
    expect(challenge?.used_at).toBeNull();
    expect(
      (await req<OwnerDeviceList>('/owner/security/devices', { cookie: first.cookie })).body
        .devices,
    ).toHaveLength(1);
  });

  it('SD-1.4 the answer must come from the passkey of this device, for a confirm challenge of this session', async () => {
    const { phone, laptop } = await twoDevices();
    await pin(laptop.cookie);
    // The laptop's passkey answering the phone's challenge.
    const opts = await req<OwnerPasskeyOptions>('/auth/owner/passkey/options', {
      body: { purpose: 'confirm' },
      cookie: phone.cookie,
    });
    const other = await remove(laptop.device.id, phone.cookie, {
      challengeId: opts.body.challengeId,
      credential: await laptop.auth.assert(opts.body.options),
    });
    expect(other.status).toBe(401);
    expect(other.code).toBe('SIGNATURE_INVALID');
    // A sign-in challenge does not remove.
    const signin = await req<OwnerPasskeyOptions>('/auth/owner/passkey/options', {
      body: { purpose: 'signin' },
    });
    const viaSignin = await remove(laptop.device.id, phone.cookie, {
      challengeId: signin.body.challengeId,
      credential: await phone.auth.assert(signin.body.options),
    });
    expect(viaSignin.code).toBe('NONCE_INVALID');
    // The phone's challenge and answer sent from the laptop's session.
    const stolen = await confirm(phone.cookie, phone.auth);
    expect((await remove(phone.device.id, laptop.cookie, stolen)).code).toBe('NONCE_INVALID');
    const live = await db(
      'SELECT COUNT(*) AS n FROM owner_passkeys WHERE removed_at IS NULL',
    ).first<{
      n: number;
    }>();
    expect(live?.n).toBe(2);
  });

  it('SD-1.5 removing this device itself signs this browser out; then the other is the last', async () => {
    const { phone, laptop } = await twoDevices();
    await pin(laptop.cookie);
    const r = await remove(
      laptop.device.id,
      laptop.cookie,
      await confirm(laptop.cookie, laptop.auth),
    );
    expect(r.status).toBe(200);
    expect(r.body.devices.map((d) => [d.id, d.current])).toEqual([[phone.device.id, false]]);
    expect((await req('/me', { cookie: laptop.cookie })).status).toBe(401);
    expect((await req('/me', { cookie: phone.cookie })).status).toBe(200);
    const last = await remove(
      phone.device.id,
      phone.cookie,
      await confirm(phone.cookie, phone.auth),
    );
    expect(last.status).toBe(422);
    expect(last.reason).toBe('last_device');
  });

  it('SD-1.6 an unknown or removed device is not found', async () => {
    const { phone, laptop } = await twoDevices();
    await db(
      'UPDATE owner_passkeys SET removed_at = ?1 WHERE id = ?2',
      now,
      laptop.device.id,
    ).run();
    const gone = await remove(
      laptop.device.id,
      phone.cookie,
      await confirm(phone.cookie, phone.auth),
    );
    expect(gone.status).toBe(404);
    const unknown = await remove(NO_ID, phone.cookie, await confirm(phone.cookie, phone.auth));
    expect(unknown.status).toBe(404);
    const rename = await req(`/owner/security/devices/${laptop.device.id}`, {
      method: 'PATCH',
      body: { deviceName: 'Old laptop' },
      cookie: phone.cookie,
    });
    expect(rename.status).toBe(404);
  });
});
