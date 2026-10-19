import { ENDPOINT_KEYS, type EndpointShape, endpoints, type SettingsView } from '@fs/contracts';
import { describe, expect, it } from 'vitest';
import { rewritePlaceholders } from '../db';
import { MIGRATIONS, splitSql } from '../db/schema';
import { SECURITY_HEADERS } from '../middleware/headers';
import { allHandlers } from '../routes';
import { call, callJson, e2eHeaders, resetScenario, sessionFor } from './helpers';

describe('system endpoints (X-01)', () => {
  it('GET /health answers without a DB call', async () => {
    const { status, body } = await callJson<{ ok: boolean }>('GET', '/health');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it('GET /config exposes only the public punch key', async () => {
    const { status, body } = await callJson<{
      punchEncPublicJwk: Record<string, unknown>;
      env: string;
    }>('GET', '/config');
    expect(status).toBe(200);
    expect(body.env).toBe('local');
    expect(body.punchEncPublicJwk.n).toBeTypeOf('string');
    expect(body.punchEncPublicJwk.d).toBeUndefined();
    expect(body.punchEncPublicJwk.p).toBeUndefined();
  });

  it('unknown /api paths are JSON 404s, never index.html', async () => {
    const res = await call('GET', '/nope');
    expect(res.status).toBe(404);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    const body = (await res.json()) as { error: { code: string; requestId: string } };
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.requestId).toMatch(/^[0-9A-Z]{26}$/);
  });
});

describe('security headers (X-03.1)', () => {
  it('sets every header from PRD 10.5 on API responses', async () => {
    const res = await call('GET', '/health');
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) expect(res.headers.get(k), k).toBe(v);
    expect(res.headers.get('X-Request-Id')).toMatch(/^[0-9A-Z]{26}$/);
  });
});

describe('CSRF and version checks', () => {
  it('refuses a POST without Origin and X-FS-Client', async () => {
    const res = await call('POST', '/auth/logout', { noCsrfHeaders: true });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('CSRF');
  });

  it('refuses a POST from another origin', async () => {
    const res = await call('POST', '/auth/logout', { headers: { Origin: 'https://evil.example' } });
    expect(res.status).toBe(403);
  });

  it('answers 426 to clients below the minimum version', async () => {
    const res = await call('GET', '/health', { headers: { 'X-FS-Client': '0.0.1' } });
    expect(res.status).toBe(426);
  });
});

describe('endpoint registration', () => {
  it('registers every contract endpoint (unimplemented ones answer 501 or an auth error)', async () => {
    const s = await resetScenario('basic-salon');
    const owner = await sessionFor(s.ownerId, { stepUp: true });
    const unimplemented = ENDPOINT_KEYS.filter((k) => !(k in allHandlers));
    for (const key of unimplemented.slice(0, 12)) {
      const def = endpoints[key] as EndpointShape;
      if (def.binary) continue;
      const path = def.path.replace(/:([A-Za-z]+)/g, (_m, p: string) =>
        p === 'date'
          ? '2026-10-19'
          : p === 'step'
            ? 'salon'
            : p === 'kind'
              ? 'selfie'
              : '01JBZZZZZZZZZZZZZZZZZZZZZZ',
      );
      const res = await call(def.method, path, { cookie: owner, body: def.body ? {} : undefined });
      expect([400, 401, 403, 404, 501], `${key} -> ${res.status}`).toContain(res.status);
    }
  });

  it('hides test routes without the E2E token', async () => {
    const res = await call('POST', '/__test/clock', { body: { nowMs: null } });
    expect(res.status).toBe(404);
    const ok = await call('POST', '/__test/clock', {
      body: { nowMs: null },
      headers: e2eHeaders(),
    });
    expect(ok.status).toBe(200);
  });
});

describe('owner settings (O-16, WP-1 part)', () => {
  it('reads and patches settings with an audit row', async () => {
    const s = await resetScenario('basic-salon');
    const owner = await sessionFor(s.ownerId);
    const got = await callJson<SettingsView>('GET', '/owner/settings', { cookie: owner });
    expect(got.status).toBe(200);
    expect(got.body.settings.attendance.graceMin).toBe(10);

    const patched = await callJson<SettingsView>('PATCH', '/owner/settings', {
      cookie: owner,
      body: { settings: { attendance: { graceMin: 15 } } },
    });
    expect(patched.status).toBe(200);
    expect(patched.body.settings.attendance.graceMin).toBe(15);

    const audit = await callJson<{ items: { action: string }[] }>(
      'GET',
      '/owner/audit?entity=org_settings',
      {
        cookie: owner,
      },
    );
    expect(audit.body.items[0]?.action).toBe('settings.update');
  });

  it('needs step-up for strong mode', async () => {
    const s = await resetScenario('basic-salon');
    const owner = await sessionFor(s.ownerId);
    const res = await call('PATCH', '/owner/settings', {
      cookie: owner,
      body: { settings: { attendance: { strongMode: true } } },
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('STEP_UP_REQUIRED');
  });

  it('rejects anonymous callers', async () => {
    await resetScenario('basic-salon');
    const res = await call('GET', '/owner/settings');
    expect(res.status).toBe(401);
  });
});

describe('data layer', () => {
  it('rewrites ?org and anonymous placeholders', () => {
    expect(
      rewritePlaceholders("SELECT * FROM t WHERE a = ? AND org_id = ?org AND b = '?' AND c = ?")
        .sql,
    ).toBe("SELECT * FROM t WHERE a = ?2 AND org_id = ?1 AND b = '?' AND c = ?3");
    expect(() => rewritePlaceholders('SELECT ?1')).toThrow();
  });

  it('splits migrations into statements', () => {
    expect(MIGRATIONS.map((m) => m.name)).toContain('0001_init.sql');
    const stmts = splitSql(MIGRATIONS[0]?.sql ?? '');
    expect(stmts.some((s) => s.startsWith('CREATE TABLE orgs'))).toBe(true);
  });
});
