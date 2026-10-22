/**
 * Worker entry (WP-1, shared): static assets, /api/v1 and scheduled jobs in one Worker (ADR-01).
 * Packages add endpoints in their route modules (routes/*), never here.
 */
import { Hono } from 'hono';
import { jobForCron, runJob } from './cron';
import type { Env } from './env';
import { isNonProd } from './env';
import { registerApi } from './lib/api';
import type { AppEnv } from './lib/app-env';
import { notFoundPage } from './lib/error-pages';
import { ApiException } from './lib/errors';
import {
  isAppRoute,
  isOwnerAccessApiPath,
  isOwnerApiPath,
  isOwnerAppPath,
  isOwnerHostApiPath,
  isStaffAppPath,
  STAFF_APP_PATHS,
  surfaceOf,
} from './lib/hosts';
import { isSplitFolderPath, serveSplitAsset } from './lib/split-assets';
import { ulid } from './lib/ulid';
import { access } from './middleware/access';
import { context } from './middleware/context';
import { errorResponse, onError } from './middleware/errors';
import { guard } from './middleware/guard';
import { withSecurityHeaders } from './middleware/headers';
import { allHandlers } from './routes';

const hasExtension = (path: string) =>
  /\.[A-Za-z0-9]+$/.test(path.slice(path.lastIndexOf('/') + 1));

export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use('*', async (c, next) => {
    const requestId = ulid();
    c.set('requestId', requestId);
    await next();
    c.res = withSecurityHeaders(c.res, requestId);
  });

  // Cloudflare Access gate for the owner host (docs/owner-access.md). Off until OWNER_HOST and
  // ACCESS_AUD are both set; first, so nothing on the owner host (shell, assets, API) skips it.
  app.use('*', access);

  // Host routing (ADR-19). While OWNER_HOST is unset only the owner-access API (passkeys, devices,
  // recovery) answers 404; everything else passes. `/api/v1` is stripped for the checks.
  app.use('*', async (c, next) => {
    const url = new URL(c.req.url);
    const surface = surfaceOf(c.env, url);
    // The split build folders are never served under their own name (nothing there in the combined build).
    if (isSplitFolderPath(url.pathname)) return c.text('Not found', 404);
    const isApi = url.pathname.startsWith('/api/');
    const path = isApi ? url.pathname.replace(/^\/api(\/v1)?/, '') || '/' : url.pathname;
    if (surface === 'combined') {
      // Owner access (passkeys, devices, recovery) lives on the owner host only.
      if (isApi && isOwnerAccessApiPath(path))
        return errorResponse(c, new ApiException('NOT_FOUND'));
      return next();
    }
    let hidden: boolean;
    if (surface === 'staff') hidden = isApi ? isOwnerApiPath(path) : isOwnerAppPath(path);
    else hidden = isApi ? !isOwnerHostApiPath(path) : isStaffAppPath(path);
    if (!hidden) return next();
    return isApi ? errorResponse(c, new ApiException('NOT_FOUND')) : c.text('Not found', 404);
  });

  // Split build (OWNER_HOST set): the shell and every static file come from the folder of the host
  // that answers, so the staff host never serves an owner file. API and door-QR routes stay below.
  app.use('*', async (c, next) => {
    const url = new URL(c.req.url);
    const surface = surfaceOf(c.env, url);
    const isRead = c.req.method === 'GET' || c.req.method === 'HEAD';
    const own = !url.pathname.startsWith('/api/') && !/^\/q(\/|$)/.test(url.pathname);
    if (surface === 'combined' || !isRead || !own) return next();
    return serveSplitAsset(c.env.ASSETS, c.req.raw, surface, isNonProd(c.env));
  });

  // Entry files that reach the Worker (wrangler `run_worker_first`) in the combined build.
  for (const p of ['/', '/index.html', '/sw.js', '/manifest.webmanifest'])
    app.get(p, (c) => c.env.ASSETS.fetch(c.req.raw));

  // Pages that only exist on one host pass through the Worker (wrangler `run_worker_first`) so the
  // rules above can hide them; the shell itself still comes from the asset layer.
  const shell = [...STAFF_APP_PATHS.filter((p) => p !== '/q'), '/o', '/auth/owner'].flatMap((p) => [
    p,
    `${p}/*`,
  ]);
  for (const p of shell) app.get(p, (c) => c.env.ASSETS.fetch(c.req.raw));

  app.use('/api/*', guard);
  app.use('/api/*', context);

  const api = new Hono<AppEnv>();
  registerApi(api, allHandlers);
  api.notFound((c) => errorResponse(c, new ApiException('NOT_FOUND')));
  app.route('/api/v1', api);
  app.all('/api/*', (c) => errorResponse(c, new ApiException('NOT_FOUND')));

  // A door QR opened with the phone camera: no punch is ever made from a URL (PRD 4.5).
  app.get('/q/*', (c) =>
    c.html(
      '<!doctype html><html lang="en-IN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Feelings Staff</title></head><body style="font-family:system-ui,sans-serif;padding:2rem;color:#1e1214"><h1 style="font-size:1.375rem">Open Feelings and tap Scan door code.</h1><p>This code only works inside the Feelings app.</p></body></html>',
    ),
  );

  // Payslip verify page and the component kit are SPA routes; the kit exists outside production only.
  // A missing hashed file must be a real 404: the asset layer's SPA fallback would answer with
  // index.html, and a stale shell would then fail on "module script" MIME errors instead of reloading.
  app.get('/assets/*', async (c) => {
    const res = await c.env.ASSETS.fetch(c.req.raw);
    const html = res.headers.get('Content-Type')?.includes('text/html');
    return res.status === 404 || html ? c.text('Not found', 404) : res;
  });
  app.get('/v/*', (c) => c.env.ASSETS.fetch(new Request(new URL('/', c.req.url))));
  app.get('/__kit', (c) =>
    isNonProd(c.env)
      ? c.env.ASSETS.fetch(new Request(new URL('/', c.req.url)))
      : c.text('Not found', 404),
  );

  // Everything else (the Worker runs first for every request, wrangler `run_worker_first: true`): a
  // real file comes from the asset layer; the layer's SPA fallback only stands for a client route.
  // An address that is neither is a real 404, so a typo or a scanner does not get a 200 shell.
  app.on(['GET', 'HEAD'], '*', async (c) => {
    const { pathname } = new URL(c.req.url);
    const res = await c.env.ASSETS.fetch(c.req.raw);
    const html = res.headers.get('Content-Type')?.includes('text/html') ?? false;
    if (res.status !== 404 && !(html && !isAppRoute(pathname, 'combined', isNonProd(c.env))))
      return res;
    return hasExtension(pathname) ? c.text('Not found', 404) : notFoundPage(c.req.method);
  });

  app.onError(onError);
  return app;
}

const app = createApp();

export default {
  fetch: app.fetch,
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    const job = jobForCron(controller.cron);
    const started = Date.now();
    const summary = await runJob(job, env, controller.scheduledTime);
    console.info(JSON.stringify({ msg: 'cron', job, ms: Date.now() - started, summary }));
  },
} satisfies ExportedHandler<Env>;
