/**
 * Cloudflare Access gate on the owner host (docs/owner-access.md slice 2). Tokens are signed in the
 * test with a generated RSA key; the certs URL is a fetch stub.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../index';
import { resetAccessCacheForTests } from '../middleware/access';
import { testEnv } from './helpers';

const OWNER = 'owner.example.test';
const TEAM = 'team.cloudflareaccess.com';
const AUD = 'aud-tag-123';
const EMAIL = 'urmi@example.test';
const CERTS = `https://${TEAM}/cdn-cgi/access/certs`;
const SHELL = '<!doctype html><div id="root"></div>';

const assets = {
  async fetch(): Promise<Response> {
    return new Response(SHELL, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  },
};

const enc = new TextEncoder();
const b64u = (b: ArrayBuffer | Uint8Array | string): string => {
  const bytes = typeof b === 'string' ? enc.encode(b) : new Uint8Array(b);
  let s = '';
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

interface Pair {
  kid: string;
  priv: CryptoKey;
  pub: JsonWebKey;
}
async function makePair(kid: string): Promise<Pair> {
  const kp = (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  return { kid, priv: kp.privateKey, pub: await crypto.subtle.exportKey('jwk', kp.publicKey) };
}

const now = () => Math.floor(Date.now() / 1000);
const goodClaims = (): Record<string, unknown> => ({
  aud: [AUD],
  iss: `https://${TEAM}`,
  email: EMAIL,
  iat: now() - 5,
  nbf: now() - 5,
  exp: now() + 600,
});

async function sign(
  pair: Pair,
  claims: Record<string, unknown> = goodClaims(),
  header: Record<string, unknown> = {},
): Promise<string> {
  const h = b64u(JSON.stringify({ alg: 'RS256', kid: pair.kid, typ: 'JWT', ...header }));
  const p = b64u(JSON.stringify(claims));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.priv, enc.encode(`${h}.${p}`));
  return `${h}.${p}.${b64u(sig)}`;
}

let pair: Pair;
let other: Pair;
let certsKeys: Pair[];
let certsStatus = 200;
let certsCalls = 0;

beforeAll(async () => {
  pair = await makePair('kid-1');
  other = await makePair('kid-2');
});

beforeEach(() => {
  resetAccessCacheForTests();
  certsKeys = [pair];
  certsStatus = 200;
  certsCalls = 0;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url !== CERTS) throw new Error(`unexpected fetch ${url}`);
    certsCalls++;
    if (certsStatus !== 200) return new Response('nope', { status: certsStatus });
    return Response.json({
      keys: certsKeys.map((k) => ({ ...k.pub, kid: k.kid, alg: 'RS256', use: 'sig' })),
    });
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

type EnvOver = Record<string, string | undefined>;
const ON: EnvOver = {
  OWNER_HOST: OWNER,
  ACCESS_AUD: AUD,
  ACCESS_TEAM_DOMAIN: TEAM,
  ACCESS_ALLOWED_EMAILS: EMAIL,
};

function get(host: string, over: EnvOver, token?: string, path = '/o') {
  const env = { ...testEnv, ASSETS: assets, ...over };
  const headers: Record<string, string> = {};
  if (token !== undefined) headers['Cf-Access-Jwt-Assertion'] = token;
  return createApp().fetch(new Request(`https://${host}${path}`, { headers }), env);
}
const owner = (over: EnvOver, token?: string, path?: string) => get(OWNER, over, token, path);

async function expectDenied(res: Response) {
  expect(res.status).toBe(403);
  expect(await res.text()).toBe('');
}

describe('access gate is off', () => {
  it('when OWNER_HOST is unset (even with ACCESS_AUD set)', async () => {
    const res = await get(OWNER, { ...ON, OWNER_HOST: undefined });
    expect(res.status).toBe(200);
    expect(certsCalls).toBe(0);
  });

  it('when ACCESS_AUD is unset', async () => {
    const res = await owner({ ...ON, ACCESS_AUD: undefined });
    expect(res.status).toBe(200);
    expect(certsCalls).toBe(0);
  });

  it('when ACCESS_AUD is blank', async () => {
    expect((await owner({ ...ON, ACCESS_AUD: '  ' })).status).toBe(200);
  });

  it('on the staff host, even with ACCESS_AUD set', async () => {
    const res = await get('staff.test', ON, undefined, '/signin');
    expect(res.status).toBe(200);
    expect(certsCalls).toBe(0);
  });
});

describe('access gate is on', () => {
  it('lets a valid token through (shell and API)', async () => {
    const token = await sign(pair);
    expect((await owner(ON, token)).status).toBe(200);
    const api = await owner(ON, token, '/api/v1/health');
    expect(api.status).toBe(200);
  });

  it('puts the verified email on the request context', async () => {
    const token = await sign(pair, { ...goodClaims(), email: ` ${EMAIL.toUpperCase()} ` });
    const env = {
      ...testEnv,
      ASSETS: assets,
      ...ON,
      ACCESS_ALLOWED_EMAILS: ` x@example.test , ${EMAIL} `,
    };
    const { access } = await import('../middleware/access');
    const { Hono } = await import('hono');
    const app = new Hono<{ Bindings: typeof env; Variables: { accessEmail?: string } }>();
    app.use('*', access as never);
    app.get('/o', (c) => c.text(c.get('accessEmail') ?? 'none'));
    const res = await app.fetch(
      new Request(`https://${OWNER}/o`, { headers: { 'Cf-Access-Jwt-Assertion': token } }),
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(EMAIL);
  });

  it('accepts a team domain with a scheme and trailing slash', async () => {
    const token = await sign(pair);
    const res = await owner({ ...ON, ACCESS_TEAM_DOMAIN: `https://${TEAM}/` }, token);
    expect(res.status).toBe(200);
  });

  it('accepts aud as a plain string', async () => {
    const token = await sign(pair, { ...goodClaims(), aud: AUD });
    expect((await owner(ON, token)).status).toBe(200);
  });

  it('accepts aud as an array that contains the tag', async () => {
    const token = await sign(pair, { ...goodClaims(), aud: ['other', AUD] });
    expect((await owner(ON, token)).status).toBe(200);
  });

  it('compares the email case-insensitively', async () => {
    const token = await sign(pair, { ...goodClaims(), email: 'URMI@Example.Test' });
    expect((await owner(ON, token)).status).toBe(200);
  });

  it('denies a missing header, with an empty body', async () => {
    await expectDenied(await owner(ON));
  });

  it('reads the header only, not the cookie', async () => {
    const token = await sign(pair);
    const env = { ...testEnv, ASSETS: assets, ...ON };
    const res = await createApp().fetch(
      new Request(`https://${OWNER}/o`, { headers: { Cookie: `CF_Authorization=${token}` } }),
      env,
    );
    await expectDenied(res);
  });

  it('denies garbage', async () => {
    await expectDenied(await owner(ON, 'not-a-jwt'));
    await expectDenied(await owner(ON, 'a.b.c'));
  });

  it('denies a bad signature', async () => {
    const token = await sign(pair);
    const [h, p] = token.split('.');
    const forged = await sign(other, goodClaims(), { kid: pair.kid });
    await expectDenied(await owner(ON, `${h}.${p}.${forged.split('.')[2]}`));
    await expectDenied(await owner(ON, forged));
  });

  it('denies a tampered payload', async () => {
    const token = await sign(pair);
    const [h, , s] = token.split('.');
    const p = b64u(JSON.stringify({ ...goodClaims(), email: 'evil@example.test' }));
    await expectDenied(await owner(ON, `${h}.${p}.${s}`));
  });

  it('denies a wrong aud', async () => {
    await expectDenied(await owner(ON, await sign(pair, { ...goodClaims(), aud: ['nope'] })));
    await expectDenied(await owner(ON, await sign(pair, { ...goodClaims(), aud: undefined })));
  });

  it('denies a wrong iss', async () => {
    const claims = { ...goodClaims(), iss: 'https://evil.cloudflareaccess.com' };
    await expectDenied(await owner(ON, await sign(pair, claims)));
  });

  it('denies an expired token', async () => {
    const claims = { ...goodClaims(), exp: now() - 1 };
    await expectDenied(await owner(ON, await sign(pair, claims)));
  });

  it('denies a token without exp', async () => {
    const { exp: _exp, ...claims } = goodClaims();
    await expectDenied(await owner(ON, await sign(pair, claims)));
  });

  it('denies nbf in the future, tolerates 60 s of skew', async () => {
    await expectDenied(await owner(ON, await sign(pair, { ...goodClaims(), nbf: now() + 300 })));
    expect((await owner(ON, await sign(pair, { ...goodClaims(), nbf: now() + 30 }))).status).toBe(
      200,
    );
  });

  it('denies iat in the future', async () => {
    await expectDenied(await owner(ON, await sign(pair, { ...goodClaims(), iat: now() + 300 })));
  });

  it('denies an email that is not allowed or missing', async () => {
    await expectDenied(
      await owner(ON, await sign(pair, { ...goodClaims(), email: 'x@example.test' })),
    );
    const { email: _email, ...claims } = goodClaims();
    await expectDenied(await owner(ON, await sign(pair, claims)));
  });

  it('rejects alg none and HS256', async () => {
    const claims = b64u(JSON.stringify(goodClaims()));
    const none = `${b64u(JSON.stringify({ alg: 'none', kid: pair.kid }))}.${claims}.`;
    await expectDenied(await owner(ON, none));
    const hs = `${b64u(JSON.stringify({ alg: 'HS256', kid: pair.kid }))}.${claims}.${b64u('x')}`;
    await expectDenied(await owner(ON, hs));
    const lower = await sign(pair, goodClaims(), { alg: 'rs256' });
    await expectDenied(await owner(ON, lower));
  });

  it('fails closed when the team domain or the allowed emails are missing', async () => {
    const token = await sign(pair);
    await expectDenied(await owner({ ...ON, ACCESS_TEAM_DOMAIN: undefined }, token));
    await expectDenied(await owner({ ...ON, ACCESS_TEAM_DOMAIN: '' }, token));
    await expectDenied(await owner({ ...ON, ACCESS_ALLOWED_EMAILS: undefined }, token));
    await expectDenied(await owner({ ...ON, ACCESS_ALLOWED_EMAILS: ' , ' }, token));
    expect(certsCalls).toBe(0);
  });

  it('denies when the certs fetch fails (status or network error)', async () => {
    const token = await sign(pair);
    certsStatus = 500;
    await expectDenied(await owner(ON, token));
    resetAccessCacheForTests();
    certsStatus = 200;
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error('boom'));
    await expectDenied(await owner(ON, token));
  });

  it('logs no token or email when it denies', async () => {
    const token = await sign(pair, { ...goodClaims(), email: 'x@example.test' });
    await owner(ON, token);
    const logged = vi.mocked(console.warn).mock.calls.flat().map(String).join(' ');
    expect(logged).toContain('access: denied');
    expect(logged).not.toContain(token);
    expect(logged).not.toContain('x@example.test');
  });
});

describe('JWKS cache', () => {
  it('fetches once for many valid requests', async () => {
    const token = await sign(pair);
    for (let i = 0; i < 3; i++) expect((await owner(ON, token)).status).toBe(200);
    expect(certsCalls).toBe(1);
  });

  it('refetches once for an unknown kid, then uses the new key', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-21T10:00:00Z'));
    expect((await owner(ON, await sign(pair))).status).toBe(200);
    expect(certsCalls).toBe(1);

    certsKeys = [pair, other];
    vi.setSystemTime(new Date('2026-10-21T10:02:00Z'));
    const token = await sign(other);
    expect((await owner(ON, token)).status).toBe(200);
    expect(certsCalls).toBe(2);
    expect((await owner(ON, token)).status).toBe(200);
    expect(certsCalls).toBe(2);
  });

  it('does not let a stream of unknown kids hammer the certs URL', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-21T10:00:00Z'));
    expect((await owner(ON, await sign(pair))).status).toBe(200);
    vi.setSystemTime(new Date('2026-10-21T10:05:00Z'));
    for (let i = 0; i < 5; i++) {
      await expectDenied(await owner(ON, await sign(other, goodClaims(), { kid: `bad-${i}` })));
    }
    expect(certsCalls).toBe(2);
  });

  it('refetches after the TTL', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-21T10:00:00Z'));
    expect((await owner(ON, await sign(pair))).status).toBe(200);
    vi.setSystemTime(new Date('2026-10-21T11:30:00Z'));
    expect((await owner(ON, await sign(pair))).status).toBe(200);
    expect(certsCalls).toBe(2);
  });
});
