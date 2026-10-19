/** The real PushSender (ADR-08) against a stubbed push service: headers, outcomes, non-prod no-op. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import { testEnv } from '../test/helpers';
import { createPushSender } from './push';

const b64url = (b: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(b instanceof Uint8Array ? b : b)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

async function keys() {
  const vapid = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
  ]);
  const jwk = await crypto.subtle.exportKey('jwk', vapid.privateKey);
  const device = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);
  const p256dh = b64url(await crypto.subtle.exportKey('raw', device.publicKey));
  const auth = b64url(crypto.getRandomValues(new Uint8Array(16)));
  return { jwk, p256dh, auth };
}

const payload = {
  web_push: 8030 as const,
  notification: { title: 'Priya is 18 min late', navigate: 'https://staff.test/o/today' },
  t: 'late_checkin' as const,
  e: '01HZZZZZZZZZZZZZZZZZZZZZZZ',
};

afterEach(() => vi.unstubAllGlobals());

describe('PushSender', () => {
  it('does not touch the network outside production', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const out = await createPushSender(testEnv).send(
      { endpoint: 'https://push.example.test/x', p256dh: 'a', auth: 'b' },
      payload,
      { ttlSec: 14400, urgency: 'high' },
    );
    expect(out).toEqual({ ok: true, status: 201 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('in production sends an encrypted, VAPID-signed request with TTL, Urgency and Topic', async () => {
    const k = await keys();
    const env = { ...testEnv, ENV: 'production', VAPID_PRIVATE_JWK: JSON.stringify(k.jwk) } as Env;
    const fetchMock = vi.fn(async () => new Response(null, { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const out = await createPushSender(env).send(
      { endpoint: 'https://push.example.test/x', p256dh: k.p256dh, auth: k.auth },
      payload,
      { ttlSec: 14400, urgency: 'high', topic: 'late-ab12cd34-20261019' },
    );
    expect(out).toEqual({ ok: true, status: 201 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://push.example.test/x');
    const h = new Headers(init.headers);
    expect(h.get('TTL')).toBe('14400');
    expect(h.get('Urgency')).toBe('high');
    expect(h.get('Topic')).toBe('late-ab12cd34-20261019');
    expect(h.get('Authorization')).toMatch(/^vapid /);
    expect(h.get('Content-Encoding')).toBe('aes128gcm');
  });

  it.each([
    [410, true],
    [404, true],
    [413, false],
    [500, false],
  ])('maps a %s answer (gone: %s)', async (status, gone) => {
    const k = await keys();
    const env = { ...testEnv, ENV: 'production', VAPID_PRIVATE_JWK: JSON.stringify(k.jwk) } as Env;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status })),
    );
    const out = await createPushSender(env).send(
      { endpoint: 'https://push.example.test/x', p256dh: k.p256dh, auth: k.auth },
      payload,
      { ttlSec: 60, urgency: 'normal' },
    );
    expect(out).toMatchObject({ ok: false, status, gone });
  });

  it('passes Retry-After on a 429', async () => {
    const k = await keys();
    const env = { ...testEnv, ENV: 'production', VAPID_PRIVATE_JWK: JSON.stringify(k.jwk) } as Env;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 429, headers: { 'Retry-After': '7' } })),
    );
    const out = await createPushSender(env).send(
      { endpoint: 'https://push.example.test/x', p256dh: k.p256dh, auth: k.auth },
      payload,
      { ttlSec: 60, urgency: 'normal' },
    );
    expect(out).toMatchObject({ ok: false, status: 429, retryAfterSec: 7 });
  });
});
