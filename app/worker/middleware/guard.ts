/**
 * CSRF, client version and per-IP rate limit for /api/* (PRD 9.1, 9.3).
 * - Non-GET requests need Origin == this origin and an X-FS-Client header.
 * - X-FS-Client below MIN_APP_VERSION gets 426 UPGRADE_REQUIRED.
 * - RL_IP: 300 per 60 s per IP (skipped locally unless X-FS-Test-RateLimit: on).
 */
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../lib/app-env';
import { fail } from '../lib/errors';

export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/).map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split(/[.+-]/).map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function rateLimitsActive(c: {
  env: { ENV: string };
  req: { header(n: string): string | undefined };
}) {
  return c.env.ENV !== 'local' || c.req.header('X-FS-Test-RateLimit') === 'on';
}

export const guard: MiddlewareHandler<AppEnv> = async (c, next) => {
  const method = c.req.method;
  const client = c.req.header('X-FS-Client');
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    const origin = c.req.header('Origin');
    const self = new URL(c.req.url).origin;
    if (!origin || origin !== self || !client) fail('CSRF');
  }
  if (client && c.env.MIN_APP_VERSION && compareVersions(client, c.env.MIN_APP_VERSION) < 0) {
    fail('UPGRADE_REQUIRED', undefined, { minAppVersion: c.env.MIN_APP_VERSION });
  }
  if (c.env.RL_IP && rateLimitsActive(c)) {
    const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';
    const { success } = await c.env.RL_IP.limit({ key: ip });
    if (!success) fail('RATE_LIMITED', undefined, undefined, { 'Retry-After': '60' });
  }
  await next();
};
