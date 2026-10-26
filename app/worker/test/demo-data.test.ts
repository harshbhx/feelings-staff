/**
 * Owner demo-data endpoints (/owner/demo/*): preview only. Any other ENV answers 404 NOT_FOUND like
 * an unknown route, before the session or the database is touched; in a preview the three steps seed
 * the demo salon in phases and keep the owner signed in. Also the demo owner identity from the env.
 */
import { describe, expect, it } from 'vitest';
import { createApp } from '../index';
import { hashPin } from '../lib/crypto';
import { SESSION_COOKIE } from '../middleware/session';
import { ORIGIN, resetScenario, sessionFor, testEnv } from './helpers';

const app = createApp();
const pending: Promise<unknown>[] = [];

async function callAs(
  envName: string | undefined,
  method: string,
  path: string,
  opts: { cookie?: string; body?: unknown; env?: Record<string, string> } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const env = { ...testEnv, ...(opts.env ?? {}) } as Record<string, unknown>;
  if (envName === undefined) delete env.ENV;
  else env.ENV = envName;
  const headers: Record<string, string> = {
    Origin: ORIGIN,
    'X-FS-Client': '0.1.0',
    'Content-Type': 'application/json',
  };
  if (opts.cookie) headers.Cookie = `${SESSION_COOKIE}=${opts.cookie}`;
  const res = await app.fetch(
    new Request(`${ORIGIN}/api/v1${path}`, {
      method,
      headers,
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    }),
    env as never,
    // finaliseRun queues the payslip PDFs with waitUntil, which needs an execution context.
    {
      waitUntil: (p: Promise<unknown>) => void pending.push(p),
      passThroughOnException: () => {},
    } as unknown as ExecutionContext,
  );
  // Let queued work (payslip PDFs) end before the next call wipes the data under it.
  await Promise.allSettled(pending.splice(0));
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : {} };
}

const STEPS: { path: string; body: unknown }[] = [
  { path: '/owner/demo/seed', body: { mode: 'reset' } },
  { path: '/owner/demo/recompute', body: { from: '2026-10-20', to: '2026-10-21' } },
  { path: '/owner/demo/finish', body: { from: '2026-09-08' } },
];

const count = async (sql: string) =>
  ((await testEnv.DB.prepare(sql).first<{ n: number }>())?.n ?? 0) as number;

describe('demo data endpoints outside a preview', () => {
  for (const envName of ['production', 'local', undefined, 'staging']) {
    it(`answer 404 NOT_FOUND when ENV is ${String(envName)}, even for a signed-in owner with step-up`, async () => {
      const s = await resetScenario('basic-salon');
      const cookie = await sessionFor(s.ownerId, { stepUp: true });
      const sessions = await count('SELECT COUNT(*) AS n FROM sessions');
      for (const step of STEPS) {
        const signedIn = await callAs(envName, 'POST', step.path, { cookie, body: step.body });
        expect(signedIn.status, step.path).toBe(404);
        expect((signedIn.body.error as { code: string }).code).toBe('NOT_FOUND');
        // The same answer for nobody at all (not 401), and for a route that does not exist.
        const anon = await callAs(envName, 'POST', step.path, { body: step.body });
        expect(anon.status, step.path).toBe(404);
      }
      const unknown = await callAs(envName, 'POST', '/owner/demo/nope', { cookie, body: {} });
      expect(unknown.status).toBe(404);
      // Nothing was wiped: the owner and the session are still there.
      expect(await count("SELECT COUNT(*) AS n FROM users WHERE role = 'owner'")).toBe(1);
      expect(await count('SELECT COUNT(*) AS n FROM sessions')).toBe(sessions);
    });
  }
});

describe('demo data endpoints in a preview', () => {
  it('loads once, keeps the owner signed in, recomputes in chunks and finishes', async () => {
    const s = await resetScenario('basic-salon');
    const cookie = await sessionFor(s.ownerId, { stepUp: true });

    // A step without step-up is refused as usual.
    const plain = await sessionFor(s.ownerId);
    const noStep = await callAs('preview', 'POST', '/owner/demo/seed', {
      cookie: plain,
      body: { mode: 'load' },
    });
    expect(noStep.status).toBe(403);
    expect((noStep.body.error as { code: string }).code).toBe('STEP_UP_REQUIRED');

    const seeded = await callAs('preview', 'POST', '/owner/demo/seed', {
      cookie,
      body: { mode: 'load' },
    });
    expect(seeded.status).toBe(200);
    expect(seeded.body.staff).toBe(12);
    expect(seeded.body.sessionKept).toBe(true);
    expect(await count("SELECT COUNT(*) AS n FROM users WHERE role = 'staff'")).toBe(12);

    // The wipe replaced the owner row, but the same cookie still works and still has step-up.
    const settings = await callAs('preview', 'GET', '/owner/settings', { cookie });
    expect(settings.status).toBe(200);
    const again = await callAs('preview', 'POST', '/owner/demo/seed', {
      cookie,
      body: { mode: 'load' },
    });
    expect(again.status).toBe(409);
    expect((again.body.error as { code: string }).code).toBe('CONFLICT');

    // Chunks: at most four days, only recent days.
    const from = seeded.body.to as string;
    const tooMany = await callAs('preview', 'POST', '/owner/demo/recompute', {
      cookie,
      body: { from: seeded.body.from, to: seeded.body.to },
    });
    expect(tooMany.status).toBe(400);
    const chunk = await callAs('preview', 'POST', '/owner/demo/recompute', {
      cookie,
      body: { from, to: from },
    });
    expect(chunk.status).toBe(200);
    expect(chunk.body).toMatchObject({ days: 1, people: 12 });
    expect(await count('SELECT COUNT(*) AS n FROM attendance_days')).toBeGreaterThan(0);

    const fin = await callAs('preview', 'POST', '/owner/demo/finish', {
      cookie,
      body: { from: seeded.body.from },
    });
    expect(fin.status).toBe(200);
    expect(fin.body.creditsStart).toBe(seeded.body.from);
    expect(await count("SELECT COUNT(*) AS n FROM payroll_runs WHERE status = 'finalised'")).toBe(
      1,
    );

    // Reset wipes and seeds again, still signed in.
    const reset = await callAs('preview', 'POST', '/owner/demo/seed', {
      cookie,
      body: { mode: 'reset' },
    });
    expect(reset.status).toBe(200);
    expect(await count('SELECT COUNT(*) AS n FROM payroll_runs')).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM users WHERE role = 'staff'")).toBe(12);
    expect((await callAs('preview', 'GET', '/owner/settings', { cookie })).status).toBe(200);
  });

  it('takes the owner identity from DEMO_OWNER_EMAIL and DEMO_OWNER_PIN and never returns the PIN', async () => {
    const s = await resetScenario('basic-salon');
    const cookie = await sessionFor(s.ownerId, { stepUp: true });
    const env = { DEMO_OWNER_EMAIL: 'Harsh@FeelingsBeautyCare.in', DEMO_OWNER_PIN: '135790' };
    const res = await callAs('preview', 'POST', '/owner/demo/seed', {
      cookie,
      body: { mode: 'reset' },
      env,
    });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('135790');
    const owner = await testEnv.DB.prepare(
      "SELECT email, pin_hash, pin_salt FROM users WHERE role = 'owner'",
    ).first<{ email: string; pin_hash: string; pin_salt: string }>();
    expect(owner?.email).toBe('harsh@feelingsbeautycare.in');
    expect(owner?.pin_hash).toBe(
      await hashPin(testEnv.PIN_PEPPER, owner?.pin_salt ?? '', '135790'),
    );
  });
});
