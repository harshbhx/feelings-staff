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
