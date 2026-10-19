/**
 * Builds the per-request Ctx for /api/* (PRD 16.3): request clock and services, session and user,
 * org id, org-scoped DB, IP hash, and the per-session rate limit (RL_SESSION, 120 / 60 s).
 */
import type { MiddlewareHandler } from 'hono';
import { OrgDb, SystemDb } from '../db';
import type { AppEnv } from '../lib/app-env';
import { hashIp } from '../lib/crypto';
import { fail } from '../lib/errors';
import type { Ctx } from '../services/ports';
import { createServices } from '../services/registry';
import { rateLimitsActive } from './guard';
import { loadSession } from './session';

/** The single org of this deployment, for public routes before sign-in (cached per isolate). */
let singleOrgId: string | null | undefined;

export async function resolveSingleOrg(sys: SystemDb): Promise<string | null> {
  if (singleOrgId) return singleOrgId;
  try {
    const row = await sys.first<{ id: string }>('SELECT id FROM orgs ORDER BY created_at LIMIT 1');
    singleOrgId = row?.id ?? null;
  } catch {
    singleOrgId = null;
  }
  return singleOrgId;
}

/** Test reset changes the org; forget the cached id. */
export function forgetSingleOrg(): void {
  singleOrgId = undefined;
}

export const context: MiddlewareHandler<AppEnv> = async (c, next) => {
  const env = c.env;
  const services = await createServices(env);
  const now = () => services.clock.now();
  const sys = new SystemDb(env.DB);
  const loaded = await loadSession(c, sys, now());
  const orgId = loaded?.session.orgId ?? (await resolveSingleOrg(sys));
  const ip = c.req.header('CF-Connecting-IP') ?? null;
  const ipHmac = ip && env.IP_HMAC_KEY ? await hashIp(env.IP_HMAC_KEY, ip) : null;
  let db: OrgDb | null = orgId ? new OrgDb(env.DB, orgId) : null;

  const ctx: Ctx = {
    env,
    requestId: c.get('requestId'),
    now,
    session: loaded?.session ?? null,
    user: loaded?.user ?? null,
    orgId,
    get db(): OrgDb {
      if (!db) {
        if (!ctx.orgId) throw new Error('No org for this request');
        db = new OrgDb(env.DB, ctx.orgId);
      }
      return db;
    },
    sys,
    ip,
    ipHmac,
    cf: (c.req.raw as Request & { cf?: IncomingRequestCfProperties }).cf ?? null,
    waitUntil: (p) => c.executionCtx.waitUntil(p),
    services,
  };
  c.set('ctx', ctx);

  if (ctx.session && env.RL_SESSION && rateLimitsActive(c)) {
    const { success } = await env.RL_SESSION.limit({ key: ctx.session.tokenHash });
    if (!success) fail('RATE_LIMITED', undefined, undefined, { 'Retry-After': '60' });
  }
  await next();
};
