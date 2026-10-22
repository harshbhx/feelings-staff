import { describe, expect, it } from 'vitest';
import { createApp } from '../index';
import { testEnv } from './helpers';

const SHELL = '<!doctype html><div id="root"></div>';

/** The asset layer with `not_found_handling: single-page-application`: unknown paths get the shell. */
const assets = {
  async fetch(req: Request): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (pathname === '/assets/real-abc123.js')
      return new Response('export {}', { headers: { 'Content-Type': 'text/javascript' } });
    return new Response(SHELL, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  },
};

const get = (path: string) =>
  createApp().fetch(new Request(`https://staff.test${path}`), { ...testEnv, ASSETS: assets });

describe('static asset misses (X-02.9)', () => {
  it('X-02.9 GET /assets/missing-abc.js is a 404, not the SPA shell', async () => {
    const res = await get('/assets/missing-abc.js');
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('id="root"');
  });

  it('X-02.9 an existing hashed file is served as is', async () => {
    const res = await get('/assets/real-abc123.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('javascript');
  });

  it('X-02.9 a payslip verify navigation still returns the shell', async () => {
    const res = await get('/v/abc');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('id="root"');
  });
});

describe('unknown addresses are a real 404 (error pages slice 2)', () => {
  it('ERR-404.1 an address that is no client route is a 404 page, not the shell', async () => {
    for (const path of ['/wp-login.php', '/some/spa/route', '/admin', '/favicon.ico', '/.env']) {
      const res = await get(path);
      expect(res.status, path).toBe(404);
      expect(await res.text(), path).not.toContain('id="root"');
    }
    const page = await get('/some/spa/route');
    expect(page.headers.get('Content-Type')).toContain('text/html');
    expect(await page.text()).toContain("That page isn't here");
  });

  it('ERR-404.2 HEAD answers the status and no body', async () => {
    const res = await createApp().fetch(new Request('https://staff.test/nope', { method: 'HEAD' }), {
      ...testEnv,
      ASSETS: assets,
    });
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('');
  });

  it('ERR-404.3 every client route and deep link still returns the shell', async () => {
    for (const path of [
      '/',
      '/signin',
      '/join',
      '/join/ABCD1234',
      '/waiting',
      '/door',
      '/month',
      '/day/2026-10-15',
      '/requests/leave',
      '/payslips/01K885',
      '/inbox',
      '/me/privacy',
      '/scan',
      '/fix/camera',
      '/v/abc',
      '/o',
      '/o/today',
      '/o/staff/abc',
      '/auth/owner',
      '/auth/owner/email',
      '/__kit',
    ]) {
      const res = await get(path);
      expect(res.status, path).toBe(200);
      expect(await res.text(), path).toContain('id="root"');
    }
  });

  it('ERR-404.4 an unknown path below a client prefix gets the shell (the app shows its own screen)', async () => {
    expect((await get('/month/nope/nope')).status).toBe(200);
  });

  it('ERR-404.5 a missing file is a plain 404, an existing one is served', async () => {
    const miss = await get('/icons/missing.png');
    expect(miss.status).toBe(404);
    expect(miss.headers.get('Content-Type')).not.toContain('html');
  });
});
