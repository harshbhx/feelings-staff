/**
 * Helpers for Workers API tests (WP-1). Every package's tests use these:
 *
 *   const s = await resetScenario('basic-salon');
 *   const owner = await sessionFor(s.ownerId);
 *   const res = await call('GET', '/owner/settings', { cookie: owner });
 */

import { env, exports } from 'cloudflare:workers';
import type { TestResetResult, TestScenario } from '@fs/contracts';
import type { Env } from '../env';
import { randomToken } from '../lib/crypto';
import { hashToken, SESSION_COOKIE } from '../middleware/session';

export const testEnv = env as unknown as Env;
export const ORIGIN = 'https://staff.test';
const worker = (exports as unknown as { default: { fetch(req: Request): Promise<Response> } })
  .default;

export interface CallOptions {
  body?: unknown;
  cookie?: string | null;
  headers?: Record<string, string>;
  /** Raw body (e.g. FormData for multipart). */
  raw?: BodyInit;
  /** Skip the Origin / X-FS-Client headers (to test CSRF). */
  noCsrfHeaders?: boolean;
}

/** Call the Worker at /api/v1<path>. */
export async function call(
  method: string,
  path: string,
  opts: CallOptions = {},
): Promise<Response> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (!opts.noCsrfHeaders) {
    headers.Origin ??= ORIGIN;
    headers['X-FS-Client'] ??= '0.1.0';
  }
  if (opts.cookie) headers.Cookie = `${SESSION_COOKIE}=${opts.cookie}`;
  let body: BodyInit | undefined = opts.raw;
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  return worker.fetch(
    new Request(`${ORIGIN}/api/v1${path}`, { method, headers, ...(body ? { body } : {}) }),
  );
}

export async function callJson<T>(
  method: string,
  path: string,
  opts: CallOptions = {},
): Promise<{ status: number; body: T }> {
  const res = await call(method, path, opts);
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : undefined) as T };
}

export function e2eHeaders(): Record<string, string> {
  return { 'X-E2E-Token': testEnv.E2E_TOKEN ?? '' };
}

export interface Scenario extends TestResetResult {
  ownerId: string;
}

/** Wipe and seed a scenario through POST /__test/reset. */
export async function resetScenario(scenario: TestScenario = 'basic-salon'): Promise<Scenario> {
  const { status, body } = await callJson<TestResetResult>('POST', '/__test/reset', {
    body: { scenario },
    headers: e2eHeaders(),
  });
  if (status !== 200) throw new Error(`reset failed: ${status} ${JSON.stringify(body)}`);
  const owner = await testEnv.DB.prepare(
    "SELECT id FROM users WHERE role = 'owner' LIMIT 1",
  ).first<{ id: string }>();
  return { ...body, ownerId: owner?.id ?? '' };
}

/**
 * Insert a session row for a user (or door device) and return the cookie token.
 * Test-only shortcut around the real sign-in flows (WP-3 tests those).
 */
export async function sessionFor(
  userId: string,
  opts: { stepUp?: boolean; kind?: 'user' | 'door'; deviceId?: string | null; orgId?: string } = {},
): Promise<string> {
  const token = randomToken(32);
  const now = Date.now();
  const orgId =
    opts.orgId ??
    (
      await testEnv.DB.prepare('SELECT org_id FROM users WHERE id = ?1')
        .bind(userId)
        .first<{ org_id: string }>()
    )?.org_id;
  if (!orgId) throw new Error(`No org for ${userId}`);
  await testEnv.DB.prepare(
    `INSERT INTO sessions (token_hash, org_id, kind, user_id, device_id, created_at, last_seen_at, expires_at, step_up_until)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?7, ?8)`,
  )
    .bind(
      await hashToken(token),
      orgId,
      opts.kind ?? 'user',
      opts.kind === 'door' ? null : userId,
      opts.deviceId ?? null,
      now,
      now + 86_400_000,
      opts.stepUp ? now + 600_000 : null,
    )
    .run();
  return token;
}
