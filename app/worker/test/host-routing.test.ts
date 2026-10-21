/**
 * Host-based routing (docs/owner-access.md slice 1, ADR-19). With OWNER_HOST unset the Worker behaves
 * as the single-host app; with it set, the owner host and the staff host each answer only their own paths.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../index';
import { SESSION_COOKIE } from '../middleware/session';
import { nextPhone, templateId } from '../routes/auth/test/kit';
import { setServiceOverridesForTests } from '../services/registry';
import { fakeEmail, fakeNotifier } from './fakes';
import { resetScenario, type Scenario, sessionFor, testEnv } from './helpers';

const OWNER = 'owner.example.test';
const STAFF_ORIGIN = 'https://staff.test';
const OWNER_ORIGIN = `https://${OWNER}`;
const SHELL = '<!doctype html><div id="root"></div>';

const assets = {
  async fetch(): Promise<Response> {
    return new Response(SHELL, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  },
};

type Mode = 'unset' | 'set';

function fetchAs(mode: Mode, host: string, path: string, init: RequestInit = {}) {
  const env = {
    ...testEnv,
    ASSETS: assets,
    ...(mode === 'set' ? { OWNER_HOST: OWNER } : {}),
  };
  return createApp().fetch(new Request(`https://${host}${path}`, init), env);
}

const STAFF_HOST = 'staff.test';
const csrf = (origin: string) => ({ Origin: origin, 'X-FS-Client': '0.1.0' });
const post = (origin: string, body: unknown = {}, extra: Record<string, string> = {}) => ({
  method: 'POST',
  headers: { ...csrf(origin), 'Content-Type': 'application/json', ...extra },
  body: JSON.stringify(body),
});

const OWNER_PAGES = ['/o', '/o/today', '/auth/owner', '/auth/owner/anything'];
const STAFF_PAGES = ['/signin', '/join/ABC', '/waiting', '/month', '/inbox', '/me/data', '/scan'];
const OWNER_API = ['/api/v1/owner/today', '/api/v1/owner/staff', '/api/v1/auth/owner/verify'];
const STAFF_API = [
  '/api/v1/auth/staff/login',
  '/api/v1/punches',
  '/api/v1/me/today',
  '/api/v1/join/lookup',
  '/api/v1/leave-requests',
];

let s: Scenario;
beforeEach(async () => {
  s = await resetScenario('basic-salon');
});
afterEach(() => setServiceOverridesForTests(null));

describe('X-HOST-1 OWNER_HOST unset changes nothing', () => {
  it.each([...OWNER_PAGES, ...STAFF_PAGES])('%s is served as the shell on any host', async (p) => {
    for (const host of [STAFF_HOST, OWNER, 'anything.test']) {
      const res = await fetchAs('unset', host, p);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('id="root"');
    }
  });

  it('owner and staff API paths are reachable on any host (auth decides, never 404)', async () => {
    for (const host of [STAFF_HOST, OWNER]) {
      for (const p of [...OWNER_API.slice(0, 2), '/api/v1/me/today', '/api/v1/me/days']) {
        const res = await fetchAs('unset', host, p);
        expect(res.status).toBe(401);
      }
      expect((await fetchAs('unset', host, '/api/v1/health')).status).toBe(200);
    }
  });

  it('the origin check still compares with the request origin', async () => {
    const own = await fetchAs('unset', OWNER, '/api/v1/auth/owner/magic', post(OWNER_ORIGIN, {}));
    expect(own.status).toBe(400);
    const other = await fetchAs(
      'unset',
      STAFF_HOST,
      '/api/v1/auth/owner/magic',
      post(OWNER_ORIGIN),
    );
    expect(other.status).toBe(403);
  });

  it('an empty OWNER_HOST counts as unset', async () => {
    const res = await createApp().fetch(new Request(`https://${STAFF_HOST}/o/today`), {
      ...testEnv,
      OWNER_HOST: '  ',
      ASSETS: assets,
    });
    expect(res.status).toBe(200);
  });
});

describe('X-HOST-2 staff host with OWNER_HOST set', () => {
  it.each(OWNER_PAGES)('%s answers 404', async (p) => {
    const res = await fetchAs('set', STAFF_HOST, p);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('id="root"');
  });

  it.each(OWNER_API)('%s answers 404 (JSON)', async (p) => {
    const res = await fetchAs('set', STAFF_HOST, p);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  });

  it('POST /auth/owner/magic answers 404 before any CSRF or handler logic', async () => {
    const res = await fetchAs('set', STAFF_HOST, '/api/v1/auth/owner/magic', post(STAFF_ORIGIN));
    expect(res.status).toBe(404);
  });

  it('staff pages, staff API and health keep working', async () => {
    for (const p of [...STAFF_PAGES, '/v/abc']) {
      expect((await fetchAs('set', STAFF_HOST, p)).status).toBe(200);
    }
    expect((await fetchAs('set', STAFF_HOST, '/api/v1/health')).status).toBe(200);
    expect((await fetchAs('set', STAFF_HOST, '/api/v1/me/today')).status).toBe(401);
    expect((await fetchAs('set', STAFF_HOST, '/api/v1/me/days')).status).toBe(401);
  });

  it('an unknown host gets the staff surface (owner paths stay hidden)', async () => {
    expect((await fetchAs('set', 'workers.example.test', '/o/today')).status).toBe(404);
    expect((await fetchAs('set', 'workers.example.test', '/api/v1/owner/today')).status).toBe(404);
  });

  it('the origin check accepts only the staff origin', async () => {
    const ok = await fetchAs('set', STAFF_HOST, '/api/v1/auth/staff/login', post(STAFF_ORIGIN));
    expect(ok.status).not.toBe(403);
    expect(ok.status).not.toBe(404);
    const bad = await fetchAs('set', STAFF_HOST, '/api/v1/auth/staff/login', post(OWNER_ORIGIN));
    expect(bad.status).toBe(403);
  });
});

describe('X-HOST-3 owner host with OWNER_HOST set', () => {
  it.each([...OWNER_PAGES, '/v/abc'])('%s is served', async (p) => {
    const res = await fetchAs('set', OWNER, p);
    expect(res.status).toBe(200);
  });

  it.each([...STAFF_PAGES, '/q/abc', '/door'])('%s answers 404', async (p) => {
    const res = await fetchAs('set', OWNER, p);
    expect(res.status).toBe(404);
  });

  it.each(STAFF_API)('%s answers 404', async (p) => {
    const res = await fetchAs('set', OWNER, p);
    expect(res.status).toBe(404);
  });

  it('owner API, owner auth and the shared read-only endpoints are answered', async () => {
    expect((await fetchAs('set', OWNER, '/api/v1/health')).status).toBe(200);
    expect((await fetchAs('set', OWNER, '/api/v1/owner/today')).status).toBe(401);
    expect((await fetchAs('set', OWNER, '/api/v1/me')).status).toBe(401);
    expect((await fetchAs('set', OWNER, '/api/v1/notifications')).status).toBe(401);
    const magic = await fetchAs('set', OWNER, '/api/v1/auth/owner/magic', post(OWNER_ORIGIN));
    expect(magic.status).toBe(400);
  });

  it('the origin check accepts only the owner origin', async () => {
    const bad = await fetchAs('set', OWNER, '/api/v1/auth/owner/magic', post(STAFF_ORIGIN));
    expect(bad.status).toBe(403);
    const none = await fetchAs('set', OWNER, '/api/v1/auth/owner/magic', {
      method: 'POST',
      headers: { 'X-FS-Client': '0.1.0', 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(none.status).toBe(403);
  });

  it('the host match is case-insensitive and exact (a sibling subdomain is staff)', async () => {
    expect((await fetchAs('set', OWNER.toUpperCase(), '/o/today')).status).toBe(200);
    expect((await fetchAs('set', `x.${OWNER}`, '/o/today')).status).toBe(404);
  });

  it('security headers are still set', async () => {
    const res = await fetchAs('set', OWNER, '/o/today');
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'self'");
  });
});

describe('X-HOST-4 links', () => {
  const owner = 'owner@feelings.test';

  it('the owner sign-in email links to the owner host when OWNER_HOST is set', async () => {
    const email = fakeEmail();
    setServiceOverridesForTests({ notifier: fakeNotifier(), email });
    const res = await fetchAs(
      'set',
      OWNER,
      '/api/v1/auth/owner/magic',
      post(OWNER_ORIGIN, { email: owner }),
    );
    expect(res.status).toBe(202);
    expect(email.sent.at(-1)?.text).toContain(`${OWNER_ORIGIN}/auth/owner?t=`);
  });

  it('the owner sign-in email links to the staff origin while OWNER_HOST is unset', async () => {
    const email = fakeEmail();
    setServiceOverridesForTests({ notifier: fakeNotifier(), email });
    const res = await fetchAs(
      'unset',
      STAFF_HOST,
      '/api/v1/auth/owner/magic',
      post(STAFF_ORIGIN, { email: owner }),
    );
    expect(res.status).toBe(202);
    expect(email.sent.at(-1)?.text).toContain(`${testEnv.APP_ORIGIN}/auth/owner?t=`);
  });

  it('invite links keep the staff origin when OWNER_HOST is set', async () => {
    setServiceOverridesForTests({ notifier: fakeNotifier(), email: fakeEmail() });
    const cookie = await sessionFor(s.ownerId);
    const phone = nextPhone();
    const res = await fetchAs('set', OWNER, '/api/v1/owner/staff', {
      method: 'POST',
      headers: {
        ...csrf(OWNER_ORIGIN),
        'Content-Type': 'application/json',
        Cookie: `${SESSION_COOKIE}=${cookie}`,
      },
      body: JSON.stringify({
        name: 'Kajal Parmar',
        phone: `0${phone.slice(3)}`,
        designation: 'Beautician',
        joinDate: '2026-10-01',
        salaryType: 'monthly',
        salaryAmountPaise: 1200000,
        defaultTemplateId: await templateId(),
        weekOffDow: 3,
        lang: 'en',
        selfieRequired: true,
        employeeCode: 'FBC-011',
        adultConfirmed: true,
      }),
    });
    expect(res.status).toBe(201);
    const { invite } = (await res.json()) as { invite: { url: string } };
    expect(invite.url.startsWith(`${testEnv.APP_ORIGIN}/join/`)).toBe(true);
    expect(invite.url).not.toContain(OWNER);
  });
});
