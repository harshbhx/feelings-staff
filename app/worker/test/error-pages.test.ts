import { describe, expect, it } from 'vitest';
import { createApp } from '../index';
import { isDatabaseUnavailable } from '../middleware/errors';
import { testEnv } from './helpers';

/** An asset layer that fails the way a broken backend does. */
const failing = (message: string) => ({
  async fetch(): Promise<Response> {
    throw new Error(message);
  },
});

const get = (path: string, message: string, headers: Record<string, string> = {}) =>
  createApp().fetch(new Request(`https://staff.test${path}`, { headers }), {
    ...testEnv,
    ASSETS: failing(message),
  });

describe('database unreachable (error pages slice 3)', () => {
  it('ERR-503.1 recognises a database that is down, not a bad query', () => {
    expect(isDatabaseUnavailable(new Error('D1 DB is overloaded. Requests queued for too long.'))).toBe(true);
    expect(isDatabaseUnavailable(new Error('D1_ERROR: D1 DB reset because its code was updated'))).toBe(true);
    expect(isDatabaseUnavailable(new Error('Network connection lost'))).toBe(true);
    expect(isDatabaseUnavailable(new Error('D1_ERROR: no such table: nope'))).toBe(false);
    expect(isDatabaseUnavailable(new Error('boom'))).toBe(false);
  });

  it('ERR-503.2 a page request gets the static maintenance page with 503 and Retry-After', async () => {
    const res = await get('/month', 'D1 DB is overloaded', { Accept: 'text/html,*/*' });
    expect(res.status).toBe(503);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    expect(res.headers.get('Retry-After')).toBe('30');
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'self'");
    const html = await res.text();
    expect(html).toContain('Back in a few minutes');
    expect(html).not.toContain('<script');
  });

  it('ERR-503.3 a data request gets the JSON UNAVAILABLE error, also 503 with Retry-After', async () => {
    const res = await get('/month', 'Network connection lost', { Accept: 'application/json' });
    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('30');
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNAVAILABLE');
  });

  it('ERR-503.4 any other failure is still a 500 INTERNAL, never the maintenance page', async () => {
    const res = await get('/month', 'boom', { Accept: 'text/html' });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INTERNAL');
  });
});
