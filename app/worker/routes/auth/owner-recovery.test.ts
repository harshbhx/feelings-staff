/**
 * Owner recovery codes, slice 7 part B (docs/owner-access.md "Passkeys" flow 5, ADR-19): the statements
 * of `scripts/owner-recovery.mjs --issue-code` run against the real schema, then the redeem route
 * (`POST /auth/owner/recovery`) and the enrolment it opens. The browser side is the software
 * authenticator in test/webauthn.ts.
 */
import type {
  Me,
  OwnerEnrolOptions,
  OwnerEnrolResult,
  OwnerPasskeyOptions,
  OwnerRecoveryRedeemResult,
} from '@fs/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  issueCodeStatements,
  newRecoveryCode,
  OWNER_LOOKUP_SQL,
  RECOVERY_CODE_TTL_MS,
  recoveryCodeHash as scriptHash,
  ulid,
} from '../../../../scripts/owner-recovery-sql.mjs';
import { createApp } from '../../index';
import { recoveryCodeHash } from '../../services/owner-recovery';
import { setServiceOverridesForTests } from '../../services/registry';
import { fakeEmail, fakeNotifier } from '../../test/fakes';
import { resetScenario, type Scenario, testEnv } from '../../test/helpers';
import { cookieFrom } from './test/kit';
import { SoftAuthenticator } from './test/webauthn';

const HOST = 'owner.example.test';
const ORIGIN = `https://${HOST}`;
const EMAIL = 'owner@feelings.test';
const START = Date.parse('2026-10-19T10:42:00+05:30');
const MIN = 60_000;
const HOUR = 60 * MIN;
const WRONG = 'ABCD-EFGH-JKMN-PQRS';

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
}

async function req<T = unknown>(path: string, o: Opts = {}) {
  const env = { ...testEnv, OWNER_HOST: HOST };
  const headers: Record<string, string> = { Origin: ORIGIN, 'X-FS-Client': '0.1.0' };
  if (o.cookie) headers.Cookie = `fs_session=${o.cookie}`;
  if (o.ip) headers['CF-Connecting-IP'] = o.ip;
  let body: string | undefined;
  if (o.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(o.body);
  }
  const res = await createApp().fetch(
    new Request(`${ORIGIN}/api/v1${path}`, {
      method: o.body !== undefined ? 'POST' : 'GET',
      headers,
      ...(body ? { body } : {}),
    }),
    env,
    execCtx,
  );
  await Promise.all(pending.splice(0));
  const text = await res.text();
  const json: unknown = text ? JSON.parse(text) : undefined;
  const error = (json as { error?: { code?: string; message?: string } } | undefined)?.error;
  return {
    status: res.status,
    body: json as T,
    cookie: cookieFrom(res),
    code: error?.code,
    message: error?.message,
    retryAfter: res.headers.get('Retry-After'),
  };
}

const db = (sql: string, ...params: unknown[]) => testEnv.DB.prepare(sql).bind(...params);

/** The first device through the email code: returns its authenticator and passkey session. */
async function firstDevice() {
  expect((await req('/auth/owner/magic', { body: { email: EMAIL } })).status).toBe(202);
  const code = email.sent.at(-1)?.subject.match(/(\d{6})$/)?.[1];
  const v = await req<Me>('/auth/owner/verify', { body: { email: EMAIL, code } });
  expect(v.status).toBe(200);
  const auth = await SoftAuthenticator.create({ rpId: HOST, origin: ORIGIN });
  const opts = await req<OwnerEnrolOptions>('/auth/owner/enrol/options', {
    body: {},
    cookie: v.cookie,
  });
  const r = await req<OwnerEnrolResult>('/auth/owner/enrol/verify', {
    body: {
      challengeId: opts.body.challengeId,
      credential: await auth.register(opts.body.options),
      deviceName: "Urmi's old iPhone",
      platform: 'ios',
    },
    cookie: v.cookie,
  });
  expect(r.status).toBe(201);
  return { auth, cookie: r.cookie as string, deviceId: r.body.device.id };
}

/** What the script does with --issue-code --yes: the statements, run on the database. */
async function issue(
  o: { at?: number; reason?: string } = {},
): Promise<{ code: string; id: string }> {
  const owners = await testEnv.DB.prepare(OWNER_LOOKUP_SQL).all<{ id: string; org_id: string }>();
  const owner = owners.results[0];
  if (!owner) throw new Error('no owner');
  const at = o.at ?? now;
  const code = newRecoveryCode();
  const id = ulid(at);
  const stmts = issueCodeStatements({
    ownerId: owner.id,
    orgId: owner.org_id,
    now: at,
    codeId: id,
    codeHash: await scriptHash(code.replaceAll('-', '')),
    auditId: ulid(at),
    reason: o.reason ?? 'Urmi lost her phone, asked by phone',
  });
  for (const sql of stmts) await testEnv.DB.prepare(sql).run();
  return { code, id };
}

const redeem = (code: string, ip?: string) =>
  req<OwnerRecoveryRedeemResult>('/auth/owner/recovery', { body: { code }, ...(ip ? { ip } : {}) });

async function enrolWith(enrolToken: string, auth: SoftAuthenticator) {
  const opts = await req<OwnerEnrolOptions>('/auth/owner/enrol/options', { body: { enrolToken } });
  expect(opts.status, JSON.stringify(opts.body)).toBe(200);
  return {
    options: opts.body.options,
    res: await req<OwnerEnrolResult>('/auth/owner/enrol/verify', {
      body: {
        challengeId: opts.body.challengeId,
        credential: await auth.register(opts.body.options),
        deviceName: "Urmi's new phone",
        platform: 'android',
        enrolToken,
      },
    }),
  };
}

async function actions(): Promise<string[]> {
  const rows = await db(
    "SELECT action FROM audit_log WHERE action LIKE 'owner.recovery_%' ORDER BY created_at, id",
  ).all<{ action: string }>();
  // Rows written in the same millisecond have no order: compare sorted.
  return rows.results.map((r) => r.action).sort();
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

describe('RC-1 --issue-code statements', () => {
  it('RC-1.1 store the code hashed for 24 hours and audit it; the code is not in the database', async () => {
    const { code, id } = await issue();
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
    const row = await db('SELECT * FROM owner_recovery_codes WHERE id = ?1', id).first<{
      user_id: string;
      code_hash: string;
      issued_by: string;
      expires_at: number;
      used_at: number | null;
    }>();
    expect(row).toMatchObject({
      user_id: s.ownerId,
      issued_by: 'admin',
      expires_at: START + RECOVERY_CODE_TTL_MS,
      used_at: null,
    });
    expect(row?.code_hash).toMatch(/^[0-9a-f]{64}$/);
    const dump = JSON.stringify(
      (await db('SELECT * FROM audit_log').all()).results.concat(
        (await db('SELECT * FROM owner_recovery_codes').all()).results,
      ),
    );
    expect(dump).not.toContain(code);
    expect(dump).not.toContain(code.replaceAll('-', ''));
    const audit = await db(
      "SELECT actor_type, entity_id, reason FROM audit_log WHERE action = 'owner.recovery_issued'",
    ).first<{ actor_type: string; entity_id: string; reason: string }>();
    expect(audit).toEqual({
      actor_type: 'system',
      entity_id: id,
      reason: 'Urmi lost her phone, asked by phone',
    });
  });

  it('RC-1.2 a new code ends the earlier unused one', async () => {
    const first = await issue();
    now += MIN;
    const second = await issue();
    expect((await redeem(first.code)).code).toBe('LINK_EXPIRED');
    expect((await redeem(second.code)).status).toBe(200);
  });

  it('RC-1.3 the script and the Worker hash a code the same way', async () => {
    const code = newRecoveryCode().replaceAll('-', '');
    expect(await recoveryCodeHash(code)).toBe(await scriptHash(code));
  });
});

describe('RC-2 redeem and enrol a fresh first device', () => {
  it('RC-2.1 code to token to passkey: the old devices and every session are gone', async () => {
    const old = await firstDevice();
    const { code, id } = await issue();
    now += 30 * MIN;
    const r = await redeem(code);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.expiresAt).toBe(now + 10 * MIN);
    expect(r.body.enrolToken.length).toBeGreaterThanOrEqual(32);
    // The code is spent at once; the token only works for enrolment, not as a session.
    expect(
      (await db('SELECT used_at FROM owner_recovery_codes WHERE id = ?1', id).first())?.used_at,
    ).toBe(now);
    expect((await req('/me', { cookie: old.cookie })).status).toBe(200);

    const fresh = await SoftAuthenticator.create({ rpId: HOST, origin: ORIGIN });
    const e = await enrolWith(r.body.enrolToken, fresh);
    expect(e.res.status, JSON.stringify(e.res.body)).toBe(201);
    // The old passkey must not block a new one: nothing is excluded.
    expect(e.options.excludeCredentials ?? []).toEqual([]);
    expect(e.res.body.device).toMatchObject({ deviceName: "Urmi's new phone", current: true });

    // Old devices: removed by 'recovery', and their session ended.
    const devices = await db(
      'SELECT id, removed_at, removed_by FROM owner_passkeys ORDER BY created_at, id',
    ).all<{ id: string; removed_at: number | null; removed_by: string | null }>();
    const gone = devices.results.find((d) => d.id === old.deviceId);
    expect(gone).toMatchObject({ removed_at: now, removed_by: 'recovery' });
    expect(devices.results.filter((d) => d.removed_at === null)).toHaveLength(1);
    expect((await req('/me', { cookie: old.cookie })).status).toBe(401);
    expect((await req('/me', { cookie: e.res.cookie })).status).toBe(200);

    // The new phone signs in with its fingerprint; the old one no longer does.
    const signIn = async (auth: SoftAuthenticator) => {
      const opts = await req<OwnerPasskeyOptions>('/auth/owner/passkey/options', {
        body: { purpose: 'signin' },
      });
      return req('/auth/owner/passkey/verify', {
        body: {
          challengeId: opts.body.challengeId,
          credential: await auth.assert(opts.body.options),
        },
      });
    };
    expect((await signIn(fresh)).status).toBe(200);
    expect((await signIn(old.auth)).status).toBe(401);

    expect(await actions()).toEqual(['owner.recovery_issued', 'owner.recovery_used']);
    const enrolled = await db(
      "SELECT after_json FROM audit_log WHERE action = 'owner.passkey_enrolled' ORDER BY created_at DESC, id DESC LIMIT 1",
    ).first<{ after_json: string }>();
    expect(JSON.parse(enrolled?.after_json ?? '{}')).toMatchObject({ via: 'recovery' });
  });

  it('RC-2.2 a code works once', async () => {
    const { code } = await issue();
    const r = await redeem(code);
    expect(r.status).toBe(200);
    const again = await redeem(code);
    expect(again.status).toBe(410);
    expect(again.code).toBe('LINK_EXPIRED');
  });

  it('RC-2.3 the token enrols once, and only inside its 10 minutes', async () => {
    const { code } = await issue();
    const r = await redeem(code);
    const a = await SoftAuthenticator.create({ rpId: HOST, origin: ORIGIN });
    expect((await enrolWith(r.body.enrolToken, a)).res.status).toBe(201);
    const again = await req('/auth/owner/enrol/options', {
      body: { enrolToken: r.body.enrolToken },
    });
    expect(again.code).toBe('LINK_EXPIRED');

    const second = await issue();
    const r2 = await redeem(second.code);
    now += 11 * MIN;
    const late = await req('/auth/owner/enrol/options', {
      body: { enrolToken: r2.body.enrolToken },
    });
    expect(late.code).toBe('LINK_EXPIRED');
  });

  it('RC-2.4 case, dashes and spaces do not matter', async () => {
    const { code } = await issue();
    const typed = code.replaceAll('-', ' ').toLowerCase();
    expect((await redeem(typed)).status).toBe(200);
  });
});

describe('RC-3 refusals tell nothing', () => {
  it('RC-3.1 unknown, expired, used and malformed codes answer the same, and are audited', async () => {
    const live = await issue();
    await redeem(live.code);
    const expired = await issue({ at: START - 25 * HOUR });
    const answers = [];
    for (const code of [
      WRONG,
      live.code,
      expired.code,
      'not a code at all',
      'UUUU-UUUU-UUUU-UUUU',
    ]) {
      const r = await redeem(code);
      answers.push([r.status, r.code, r.message]);
    }
    expect(new Set(answers.map((a) => a.join('|'))).size).toBe(1);
    expect(answers[0]?.[0]).toBe(410);
    expect(await actions()).toEqual([
      ...Array(5).fill('owner.recovery_failed'),
      'owner.recovery_issued',
      'owner.recovery_issued',
      'owner.recovery_used',
    ]);
  });

  it('RC-3.2 an owner who is no longer active cannot redeem', async () => {
    const { code } = await issue();
    await db("UPDATE users SET status = 'exited' WHERE id = ?1", s.ownerId).run();
    expect((await redeem(code)).code).toBe('LINK_EXPIRED');
  });

  it('RC-3.3 five wrong codes per IP in 15 minutes, then 429, even for the right code', async () => {
    const { code } = await issue();
    for (let i = 0; i < 5; i++) expect((await redeem(WRONG, '203.0.113.9')).status).toBe(410);
    const limited = await redeem(code, '203.0.113.9');
    expect(limited.status).toBe(429);
    expect(limited.code).toBe('RATE_LIMITED');
    expect(Number(limited.retryAfter)).toBeGreaterThan(0);
    // Another address is not affected, and the window passes.
    expect((await redeem(code, '203.0.113.10')).status).toBe(200);
    now += 16 * MIN;
    expect((await redeem(WRONG, '203.0.113.9')).status).toBe(410);
  });

  it('RC-3.4 twenty wrong codes in 15 minutes lock the whole salon', async () => {
    for (let i = 0; i < 20; i++) await redeem(WRONG, `198.51.100.${i + 1}`);
    expect((await redeem(WRONG, '198.51.100.99')).status).toBe(429);
  });
});
