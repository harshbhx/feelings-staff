/**
 * Forgotten owner PIN (docs/owner-access.md, Passkeys flow 6; PRD 4.1.7 "Owner PIN forgotten"):
 * the self-service reset through `PUT /owner/security/pin` without the current PIN, and the admin
 * `scripts/owner-recovery.mjs --clear-pin` statements run against the real schema.
 */
import type { Endpoints, Me, OutputOf } from '@fs/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearPinStatements,
  OWNER_LOOKUP_SQL,
  ulid,
} from '../../../../scripts/owner-recovery-sql.mjs';
import { setServiceOverridesForTests } from '../../services/registry';
import { fakeEmail, fakeNotifier } from '../../test/fakes';
import {
  call,
  callJson,
  resetScenario,
  type Scenario,
  sessionFor,
  testEnv,
} from '../../test/helpers';
import { auditActions, cookieFrom, errorCode, setClock } from './test/kit';

const OWNER_EMAIL = 'owner@feelings.test';
const OWNER_PASSWORD = 'feelings-demo-2026';
const OWNER_PIN = '482913';
const NEW_PIN = '739164';
const WINDOW_MS = 15 * 60_000;

type SecurityView = OutputOf<Endpoints['ownerSecurityGet']>;

let s: Scenario;
let email: ReturnType<typeof fakeEmail>;

beforeEach(async () => {
  s = await resetScenario('basic-salon');
  email = fakeEmail();
  setServiceOverridesForTests({ notifier: fakeNotifier(), email });
});

afterEach(async () => {
  setServiceOverridesForTests(null);
  await setClock(null);
});

/** Real owner sign-in by the 6-digit code or the link from the email; returns the session cookie. */
async function emailSignIn(via: 'code' | 'link' = 'code'): Promise<string> {
  const sent = await call('POST', '/auth/owner/magic', { body: { email: OWNER_EMAIL } });
  expect(sent.status).toBe(202);
  const msg = email.sent.at(-1);
  if (!msg) throw new Error('no sign-in email');
  const code = msg.subject.match(/(\d{6})$/)?.[1] ?? '';
  const token = decodeURIComponent(msg.text.match(/\?t=([A-Za-z0-9_%-]+)/)?.[1] ?? '');
  const res = await call('POST', '/auth/owner/verify', {
    body: via === 'code' ? { email: OWNER_EMAIL, code } : { token },
  });
  expect(res.status).toBe(200);
  const cookie = cookieFrom(res);
  if (!cookie) throw new Error('no session cookie');
  return cookie;
}

async function passwordSignIn(): Promise<string> {
  const res = await call('POST', '/auth/owner/password', {
    body: { email: OWNER_EMAIL, password: OWNER_PASSWORD, pin: OWNER_PIN },
  });
  expect(res.status).toBe(200);
  const cookie = cookieFrom(res);
  if (!cookie) throw new Error('no session cookie');
  return cookie;
}

async function security(cookie: string): Promise<SecurityView> {
  const res = await callJson<SecurityView>('GET', '/owner/security', { cookie });
  expect(res.status).toBe(200);
  return res.body;
}

function resetPin(cookie: string, pin = NEW_PIN): Promise<Response> {
  return call('PUT', '/owner/security/pin', { cookie, body: { pin } });
}

async function expectRefused(res: Response): Promise<void> {
  expect(res.status).toBe(422);
  expect(await errorCode(res)).toMatchObject({
    code: 'RULE_VIOLATION',
    details: { reason: 'recent_sign_in_required' },
  });
}

async function stepUp(cookie: string, pin: string): Promise<Response> {
  return call('POST', '/auth/step-up', { cookie, body: { pin } });
}

async function ownerPinRow() {
  return testEnv.DB.prepare(
    'SELECT pin_hash, pin_failures, pin_locked_until FROM users WHERE id = ?1',
  )
    .bind(s.ownerId)
    .first<{ pin_hash: string | null; pin_failures: number; pin_locked_until: number | null }>();
}

describe('forgotten owner PIN: self-service reset', () => {
  it('is refused without a fresh sign-in (a session that never signed in by email)', async () => {
    const owner = await sessionFor(s.ownerId);
    expect((await security(owner)).pinResetUntil).toBeNull();
    await expectRefused(await resetPin(owner));
    expect(await auditActions(s.ownerId)).not.toContain('owner.pin_reset');
    expect((await stepUp(owner, OWNER_PIN)).status).toBe(200);
  });

  it('is refused after a password sign-in: the password alone never replaces the PIN', async () => {
    const owner = await passwordSignIn();
    expect((await security(owner)).pinResetUntil).toBeNull();
    await expectRefused(await resetPin(owner));
    expect((await stepUp(owner, OWNER_PIN)).status).toBe(200);
  });

  it('is refused 15 minutes after the email sign-in', async () => {
    const owner = await emailSignIn('code');
    const open = (await security(owner)).pinResetUntil;
    expect(open).toBeGreaterThan(Date.now());
    expect(open).toBeLessThanOrEqual(Date.now() + WINDOW_MS);
    await setClock(Date.now() + WINDOW_MS + 60_000);
    expect((await security(owner)).pinResetUntil).toBeNull();
    await expectRefused(await resetPin(owner));
  });

  it('works once inside the window: old PIN stops, other sessions end, audit row and email', async () => {
    const otherDevice = await sessionFor(s.ownerId);
    const owner = await emailSignIn('code');
    // A lock from wrong tries after the sign-in is lifted by the reset too.
    await testEnv.DB.prepare(
      'UPDATE users SET pin_failures = 4, pin_locked_until = ?1 WHERE id = ?2',
    )
      .bind(Date.now() + 10 * 60_000, s.ownerId)
      .run();
    const before = (await ownerPinRow())?.pin_hash;

    const res = await callJson<SecurityView>('PUT', '/owner/security/pin', {
      cookie: owner,
      body: { pin: NEW_PIN },
    });
    expect(res.status).toBe(200);
    expect(res.body.pinSet).toBe(true);
    expect(res.body.pinResetUntil).toBeNull();
    expect(res.body.sessions).toHaveLength(1);

    const row = await ownerPinRow();
    expect(row?.pin_hash).not.toBe(before);
    expect(row).toMatchObject({ pin_failures: 0, pin_locked_until: null });

    expect(await errorCode(await stepUp(owner, OWNER_PIN))).toMatchObject({ code: 'PIN_WRONG' });
    expect((await stepUp(owner, NEW_PIN)).status).toBe(200);

    expect((await call('GET', '/me', { cookie: otherDevice })).status).toBe(401);
    expect((await call('GET', '/me', { cookie: owner })).status).toBe(200);

    expect(await auditActions(s.ownerId)).toContain('owner.pin_reset');
    const notice = email.sent.at(-1);
    expect(notice?.to).toBe(OWNER_EMAIL);
    expect(notice?.subject).toBe('Your Feelings Staff owner PIN was changed');
    expect(notice?.text).toContain(
      'Every other phone and computer signed in as you was signed out.',
    );
    expect(notice?.text).not.toContain(NEW_PIN);
  });

  it('works only once per sign-in; a new email sign-in (the link) opens it again', async () => {
    const owner = await emailSignIn('code');
    expect((await resetPin(owner, NEW_PIN)).status).toBe(200);
    await expectRefused(await resetPin(owner, '518206'));
    expect((await stepUp(owner, NEW_PIN)).status).toBe(200);

    const again = await emailSignIn('link');
    expect((await security(again)).pinResetUntil).toBeGreaterThan(Date.now());
    expect((await resetPin(again, '518206')).status).toBe(200);
    expect((await stepUp(again, '518206')).status).toBe(200);
    expect((await auditActions(s.ownerId)).filter((a) => a === 'owner.pin_reset')).toHaveLength(2);
  });

  it('a change with the current PIN still works and closes the reset window', async () => {
    const owner = await emailSignIn('code');
    const changed = await callJson<SecurityView>('PUT', '/owner/security/pin', {
      cookie: owner,
      body: { pin: NEW_PIN, currentPin: OWNER_PIN },
    });
    expect(changed.status).toBe(200);
    expect(changed.body.pinResetUntil).toBeNull();
    expect(await auditActions(s.ownerId)).toContain('owner.pin_change');
    await expectRefused(await resetPin(owner, '518206'));
  });

  it('is rate limited like every signed-in route (RL_SESSION, 120 per 60 s)', async () => {
    const owner = await sessionFor(s.ownerId);
    const headers = { 'X-FS-Test-RateLimit': 'on' };
    let limited: Response | null = null;
    // Two windows at most, in case the loop starts just before a window boundary.
    for (let i = 0; i < 245 && !limited; i++) {
      const res = await call('PUT', '/owner/security/pin', {
        cookie: owner,
        headers,
        body: { pin: NEW_PIN },
      });
      if (res.status === 429) limited = res;
      else expect(res.status).toBe(422);
    }
    if (!limited) throw new Error('never rate limited');
    expect((await errorCode(limited)).code).toBe('RATE_LIMITED');
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(await auditActions(s.ownerId)).not.toContain('owner.pin_reset');
  });
});

describe('forgotten owner PIN: admin --clear-pin (scripts/owner-recovery.mjs)', () => {
  it('clears the PIN, signs the owner out, audits, and the next sign-in sets a first PIN', async () => {
    const before = await emailSignIn('code');
    const owners = await testEnv.DB.prepare(OWNER_LOOKUP_SQL).all<{
      id: string;
      org_id: string;
      pin_set: number;
    }>();
    expect(owners.results).toHaveLength(1);
    const owner = owners.results[0];
    if (!owner) throw new Error('no owner');
    expect(owner).toMatchObject({ id: s.ownerId, pin_set: 1 });
    expect(Object.keys(owner)).not.toContain('pin_hash');

    const now = Date.now();
    const stmts = clearPinStatements({
      ownerId: owner.id,
      orgId: owner.org_id,
      now,
      auditId: ulid(now),
      reason: "Owner's PIN forgotten",
    });
    for (const sql of stmts) await testEnv.DB.prepare(sql).run();
    // Safe to run twice.
    for (const sql of clearPinStatements({
      ownerId: owner.id,
      orgId: owner.org_id,
      now,
      auditId: ulid(now),
      reason: 'again',
    }))
      await testEnv.DB.prepare(sql).run();

    expect(await ownerPinRow()).toMatchObject({
      pin_hash: null,
      pin_failures: 0,
      pin_locked_until: null,
    });
    expect((await call('GET', '/me', { cookie: before })).status).toBe(401);
    expect(await auditActions(s.ownerId)).toContain('owner.pin_cleared_by_admin');
    const audit = await testEnv.DB.prepare(
      "SELECT actor_type, reason FROM audit_log WHERE action = 'owner.pin_cleared_by_admin'",
    ).all<{ actor_type: string; reason: string }>();
    // Two runs (same millisecond, so no order): one row each, actor `system`, with the reason.
    expect(audit.results.map((r) => r.reason).sort()).toEqual(["Owner's PIN forgotten", 'again']);
    expect(audit.results.every((r) => r.actor_type === 'system')).toBe(true);

    // The password alone cannot sign in without a PIN.
    const password = await call('POST', '/auth/owner/password', {
      body: { email: OWNER_EMAIL, password: OWNER_PASSWORD, pin: OWNER_PIN },
    });
    expect((await errorCode(password)).code).toBe('PIN_WRONG');

    // Next sign-in: the first-PIN flow.
    const next = await emailSignIn('code');
    const me = await callJson<Me>('GET', '/me', { cookie: next });
    expect(me.body.flags.ownerPinSet).toBe(false);
    expect((await security(next)).pinResetUntil).toBeNull();
    expect((await resetPin(next, NEW_PIN)).status).toBe(200);
    expect(await auditActions(s.ownerId)).toContain('owner.pin_set');
    // Setting the first PIN uses up this sign-in: no "new PIN without the old one" form after it.
    expect((await security(next)).pinResetUntil).toBeNull();
    expect((await stepUp(next, NEW_PIN)).status).toBe(200);
  });
});
