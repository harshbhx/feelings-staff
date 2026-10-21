/**
 * Cloudflare Access gate for the owner host (docs/owner-access.md, slice 2).
 *
 * Off (a pass-through) unless the request is for the owner surface AND `ACCESS_AUD` is set, so
 * builds, previews and today's production behave exactly as before. Once on it is mandatory and
 * fails closed: every problem answers 403 with an empty body. The reason goes to `console.warn`
 * (never the token or the e-mail).
 *
 * Verification: the `Cf-Access-Jwt-Assertion` header only, RS256 only, signature checked with
 * WebCrypto against the team's JWKS (key picked by `kid`), then `aud`, `iss`, `exp`, `nbf`/`iat`
 * (60 s skew) and the `email` claim against `ACCESS_ALLOWED_EMAILS`.
 */
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../lib/app-env';
import { surfaceOf } from '../lib/hosts';

const SKEW_S = 60;
const JWKS_TTL_MS = 60 * 60 * 1000;
const JWKS_STALE_MAX_MS = 24 * 60 * 60 * 1000;
const REFETCH_MIN_MS = 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;

interface Jwks {
  domain: string;
  keys: Map<string, CryptoKey>;
  fetchedAt: number;
}

let cache: Jwks | null = null;
let lastAttemptAt = 0;
let lastAttemptDomain = '';
let inflight: Promise<Jwks | null> | null = null;

/** Test helper: forget the JWKS cache and the refetch rate limit. */
export function resetAccessCacheForTests(): void {
  cache = null;
  lastAttemptAt = 0;
  lastAttemptDomain = '';
  inflight = null;
}

/** "team.cloudflareaccess.com", with or without scheme or trailing slash, in lower case. */
export function normaliseTeamDomain(raw: string | undefined): string {
  return (raw ?? '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

function allowedEmails(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error('bad base64url');
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function parseJson(part: string): Record<string, unknown> {
  const v: unknown = JSON.parse(new TextDecoder().decode(b64urlToBytes(part)));
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error('not an object');
  return v as Record<string, unknown>;
}

async function fetchJwks(domain: string): Promise<Jwks | null> {
  try {
    const res = await fetch(`https://${domain}/cdn-cgi/access/certs`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { keys?: Array<JsonWebKey & { kid?: string }> };
    const keys = new Map<string, CryptoKey>();
    for (const jwk of body.keys ?? []) {
      if (jwk.kty !== 'RSA' || !jwk.kid || !jwk.n || !jwk.e) continue;
      try {
        const key = await crypto.subtle.importKey(
          'jwk',
          { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
          { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
          false,
          ['verify'],
        );
        keys.set(jwk.kid, key);
      } catch {
        // skip a key that cannot be imported
      }
    }
    return { domain, keys, fetchedAt: Date.now() };
  } catch {
    return null;
  }
}

/**
 * The verification key for `kid`. The cache is fresh for one hour; an unknown `kid` forces one
 * refetch, and the certs URL is contacted at most once per minute however many bad tokens arrive.
 * When a refetch fails (network error or non-200), a key already cached is still used for up to
 * 24 hours, so a Cloudflare certs hiccup does not lock the owner out. A `kid` that is not cached
 * is never allowed on a failed fetch.
 */
async function keyFor(domain: string, kid: string): Promise<CryptoKey | null> {
  const now = Date.now();
  const cached = cache && cache.domain === domain ? cache : null;
  const age = cached ? now - cached.fetchedAt : Number.POSITIVE_INFINITY;
  const hit = cached?.keys.get(kid);
  if (hit && age < JWKS_TTL_MS) return hit;
  const stale = hit && age < JWKS_STALE_MAX_MS ? hit : null;

  if (lastAttemptDomain === domain && now - lastAttemptAt < REFETCH_MIN_MS) {
    if (inflight) return (await inflight)?.keys.get(kid) ?? stale;
    return stale;
  }
  lastAttemptAt = now;
  lastAttemptDomain = domain;
  inflight = fetchJwks(domain);
  const jwks = await inflight;
  inflight = null;
  if (!jwks) return stale;
  cache = jwks;
  return jwks.keys.get(kid) ?? null;
}

type Verdict = { ok: true; email: string } | { ok: false; reason: string };

export async function verifyAccessJwt(
  token: string | undefined,
  cfg: { domain: string; aud: string; emails: Set<string> },
  nowMs: number = Date.now(),
): Promise<Verdict> {
  const no = (reason: string): Verdict => ({ ok: false, reason });
  if (!token) return no('missing header');
  const parts = token.split('.');
  if (parts.length !== 3) return no('malformed token');
  const [h, p, sig] = parts as [string, string, string];
  let header: Record<string, unknown>;
  let claims: Record<string, unknown>;
  let signature: Uint8Array<ArrayBuffer>;
  try {
    header = parseJson(h);
    claims = parseJson(p);
    signature = b64urlToBytes(sig);
  } catch {
    return no('malformed token');
  }
  if (header.alg !== 'RS256') return no('alg not RS256');
  if (typeof header.kid !== 'string' || !header.kid) return no('no kid');

  const key = await keyFor(cfg.domain, header.kid);
  if (!key) return no('no key for kid or certs unavailable');
  let valid = false;
  try {
    valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      signature,
      new TextEncoder().encode(`${h}.${p}`),
    );
  } catch {
    valid = false;
  }
  if (!valid) return no('bad signature');

  const nowS = Math.floor(nowMs / 1000);
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(cfg.aud)) return no('aud mismatch');
  if (claims.iss !== `https://${cfg.domain}`) return no('iss mismatch');
  if (typeof claims.exp !== 'number' || claims.exp <= nowS) return no('expired');
  if (claims.nbf !== undefined && (typeof claims.nbf !== 'number' || claims.nbf > nowS + SKEW_S))
    return no('not yet valid');
  if (claims.iat !== undefined && (typeof claims.iat !== 'number' || claims.iat > nowS + SKEW_S))
    return no('issued in the future');
  if (typeof claims.email !== 'string') return no('no email claim');
  const email = claims.email.trim().toLowerCase();
  if (!cfg.emails.has(email)) return no('email not allowed');
  return { ok: true, email };
}

const forbidden = () => new Response(null, { status: 403 });

export const access: MiddlewareHandler<AppEnv> = async (c, next) => {
  const env = c.env;
  const aud = (env.ACCESS_AUD ?? '').trim();
  if (!aud || surfaceOf(env, new URL(c.req.url)) !== 'owner') return next();

  const domain = normaliseTeamDomain(env.ACCESS_TEAM_DOMAIN);
  const emails = allowedEmails(env.ACCESS_ALLOWED_EMAILS);
  if (!domain || emails.size === 0) {
    console.warn('access: ACCESS_AUD is set but the team domain or allowed emails are missing');
    return forbidden();
  }
  const verdict = await verifyAccessJwt(c.req.header('Cf-Access-Jwt-Assertion'), {
    domain,
    aud,
    emails,
  });
  if (!verdict.ok) {
    console.warn(`access: denied (${verdict.reason})`);
    return forbidden();
  }
  c.set('accessEmail', verdict.email);
  return next();
};
