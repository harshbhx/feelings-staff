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
import { ApiException } from './lib/errors';
import { ulid } from './lib/ulid';
import { context } from './middleware/context';
import { errorResponse, onError } from './middleware/errors';
import { guard } from './middleware/guard';
import { withSecurityHeaders } from './middleware/headers';
import { allHandlers } from './routes';

export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use('*', async (c, next) => {
    const requestId = ulid();
    c.set('requestId', requestId);
    await next();
    c.res = withSecurityHeaders(c.res, requestId);
  });

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
