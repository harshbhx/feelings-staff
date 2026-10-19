/** System endpoints (WP-1): health, public config, signed server time. */
import type { Handlers } from '../lib/api';
import { signTime } from '../lib/crypto';
import { fail } from '../lib/errors';

let publicJwkCache: { source: string; jwk: Record<string, unknown> } | null = null;

/** Derive the RSA-OAEP public JWK from the private one (only n, e and metadata leave the Worker). */
function publicJwkFrom(privateJwk: string): Record<string, unknown> {
  if (publicJwkCache?.source === privateJwk) return publicJwkCache.jwk;
  let jwk: Record<string, unknown> = {};
  try {
    const p = JSON.parse(privateJwk) as Record<string, unknown>;
    jwk = { kty: p.kty, n: p.n, e: p.e, alg: 'RSA-OAEP-256', use: 'enc', key_ops: ['encrypt'] };
  } catch {
    jwk = {};
  }
  publicJwkCache = { source: privateJwk, jwk };
  return jwk;
}

export const handlers: Handlers = {
  async health() {
    return {
      ok: true as const,
      version: import.meta.env.VITE_APP_VERSION ?? 'dev',
      commit: import.meta.env.VITE_COMMIT ?? 'dev',
    };
  },

  async config(_input, ctx, c) {
    c.header('Cache-Control', 'public, max-age=300');
    let orgDisplayName: string | undefined;
    if (ctx.orgId) {
      const org = await ctx.sys.first<{ name: string }>(
        'SELECT name FROM orgs WHERE id = ?1',
        ctx.orgId,
      );
      orgDisplayName = org?.name;
    }
    return {
      minAppVersion: ctx.env.MIN_APP_VERSION,
      vapidPublicKey: ctx.env.VAPID_PUBLIC_KEY ?? '',
      punchEncPublicJwk: publicJwkFrom(ctx.env.PUNCH_ENC_PRIVATE_JWK ?? ''),
      ...(orgDisplayName ? { orgDisplayName } : {}),
      env: ctx.env.ENV,
      version: import.meta.env.VITE_APP_VERSION ?? 'dev',
    };
  },

  async time(_input, ctx) {
    if (!ctx.env.TIME_SIGNING_KEY) fail('UNAVAILABLE');
    const serverTime = ctx.now();
    const deviceId = ctx.session?.deviceId ?? '';
    return { serverTime, timeSig: await signTime(ctx.env.TIME_SIGNING_KEY, serverTime, deviceId) };
  },
};
