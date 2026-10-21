/**
 * Split build file serving (docs/owner-access.md slice 1b). With OWNER_HOST set each host is served from
 * its own build folder (`/_s` staff, `/_o` owner) as if it were the site root; with it unset the asset
 * layer's combined build is untouched.
 */
import { describe, expect, it } from 'vitest';
import { createApp } from '../index';
import { testEnv } from './helpers';

const OWNER = 'owner.example.test';
const STAFF = 'staff.test';

/** An asset layer with a few files per folder; anything else is a miss (404 or the SPA fallback). */
function makeAssets(requested: string[], fallbackToShell = false) {
  const files: Record<string, { type: string; body: string }> = {
    '/_s/': { type: 'text/html', body: 'staff shell' },
    '/_o/': { type: 'text/html', body: 'owner shell' },
    '/_s/assets/staff-1.js': { type: 'text/javascript', body: 'staff js' },
    '/_o/assets/owner-1.js': { type: 'text/javascript', body: 'owner js' },
    '/_s/sw.js': { type: 'text/javascript', body: 'staff sw' },
    '/_o/manifest.webmanifest': { type: 'application/manifest+json', body: '{"name":"owner"}' },
  };
  return {
    async fetch(input: Request | string | URL): Promise<Response> {
      const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
      requested.push(path);
      const hit = files[path];
      if (hit) return new Response(hit.body, { headers: { 'Content-Type': hit.type } });
      if (fallbackToShell)
        return new Response('combined shell', { headers: { 'Content-Type': 'text/html' } });
      return new Response('nope', { status: 404 });
    },
  } as unknown as Fetcher;
}

async function fetchAs(
  host: string,
  path: string,
  opts: { set?: boolean; fallback?: boolean } = {},
) {
  const requested: string[] = [];
  const env = {
    ...testEnv,
    ASSETS: makeAssets(requested, opts.fallback),
    ...(opts.set === false ? {} : { OWNER_HOST: OWNER }),
  };
  const res = await createApp().fetch(new Request(`https://${host}${path}`), env);
  return { res, requested };
}

describe('X-SPLIT-1 files come from the folder of the answering host', () => {
  it('X-SPLIT-1.1 each host gets its own shell for app routes and the root', async () => {
    for (const path of ['/', '/index.html', '/me', '/some/deep/link'])
      expect(await (await fetchAs(STAFF, path)).res.text()).toBe('staff shell');
    expect(await (await fetchAs(OWNER, '/o/today')).res.text()).toBe('owner shell');
    expect(await (await fetchAs(OWNER, '/index.html')).res.text()).toBe('owner shell');
  });

  it('X-SPLIT-1.2 a hashed file is read from the host folder, a file of the other host is a 404', async () => {
    expect(await (await fetchAs(STAFF, '/assets/staff-1.js')).res.text()).toBe('staff js');
    expect(await (await fetchAs(OWNER, '/assets/owner-1.js')).res.text()).toBe('owner js');
    expect((await fetchAs(STAFF, '/assets/owner-1.js')).res.status).toBe(404);
    expect((await fetchAs(OWNER, '/assets/staff-1.js')).res.status).toBe(404);
  });

  it('X-SPLIT-1.3 a missing file is a 404 even when the asset layer falls back to a shell', async () => {
    const miss = await fetchAs(STAFF, '/assets/gone-9.js', { fallback: true });
    expect(miss.res.status).toBe(404);
  });

  it('X-SPLIT-1.4 the service worker and manifest are revalidated on each host', async () => {
    const sw = await fetchAs(STAFF, '/sw.js');
    expect(sw.res.status).toBe(200);
    expect(sw.res.headers.get('Cache-Control')).toBe('no-cache');
    const manifest = await fetchAs(OWNER, '/manifest.webmanifest');
    expect(await manifest.res.json()).toEqual({ name: 'owner' });
    expect(manifest.res.headers.get('Cache-Control')).toBe('no-cache');
  });

  it('X-SPLIT-1.5 the build folders answer 404 on every host and never reach the asset layer', async () => {
    for (const host of [STAFF, OWNER]) {
      for (const path of ['/_s/index.html', '/_o/assets/owner-1.js', '/_s', '/_o/']) {
        const { res, requested } = await fetchAs(host, path);
        expect(res.status, `${host}${path}`).toBe(404);
        expect(requested).toEqual([]);
      }
    }
    expect((await fetchAs(STAFF, '/_o/assets/owner-1.js', { set: false })).res.status).toBe(404);
  });

  it('X-SPLIT-1.6 with OWNER_HOST unset the asset layer is called with the original path', async () => {
    const { res, requested } = await fetchAs(STAFF, '/sw.js', { set: false });
    expect(requested).toEqual(['/sw.js']);
    expect(res.status).toBe(404);
    const root = await fetchAs(STAFF, '/', { set: false });
    expect(root.requested).toEqual(['/']);
    const manifest = await fetchAs(STAFF, '/manifest.webmanifest', { set: false });
    expect(manifest.requested).toEqual(['/manifest.webmanifest']);
  });

  it('X-SPLIT-1.7 the API is not served from the folders', async () => {
    const { res, requested } = await fetchAs(OWNER, '/api/v1/health');
    expect(res.status).toBe(200);
    expect(requested).toEqual([]);
  });
});
