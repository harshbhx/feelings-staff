/** Maps any thrown error to the PRD 9.2 shape. Never leaks stack traces. */
import type { ApiErrorBody } from '@fs/contracts';
import type { Context } from 'hono';
import type { AppEnv } from '../lib/app-env';
import { maintenancePage } from '../lib/error-pages';
import { ApiException, isApiException } from '../lib/errors';

export function errorResponse(c: Context<AppEnv>, e: ApiException): Response {
  const body: ApiErrorBody = {
    error: {
      code: e.code,
      message: e.message,
      ...(e.details ? { details: e.details } : {}),
      requestId: c.get('requestId') ?? 'unknown',
    },
  };
  const res = c.json(body, e.status as 400);
  if (e.headers) for (const [k, v] of Object.entries(e.headers)) res.headers.set(k, v);
  return res;
}

/**
 * D1 or the network to it is down or restarting (not a bug in a query): "D1 DB is overloaded", "D1 DB
 * reset because its code was updated", "Network connection lost" and the like. Plain `D1_ERROR`
 * (bad SQL, constraint) is not matched on purpose: that stays a 500 so it gets noticed.
 */
const DB_DOWN =
  /D1 DB is overloaded|D1 DB reset|storage caused object to be reset|Network connection lost|D1_ERROR: .*(timed out|temporarily unavailable)|database is unavailable/i;

export function isDatabaseUnavailable(err: unknown): boolean {
  return DB_DOWN.test(err instanceof Error ? err.message : String(err));
}

const wantsPage = (c: Context<AppEnv>) =>
  (c.req.method === 'GET' || c.req.method === 'HEAD') &&
  (c.req.header('Accept') ?? '').includes('text/html');

export function onError(err: Error, c: Context<AppEnv>): Response {
  if (isApiException(err)) return errorResponse(c, err);
  if (isDatabaseUnavailable(err)) {
    const requestId = c.get('requestId');
    console.error(JSON.stringify({ msg: 'database_unavailable', requestId, error: err.message }));
    if (wantsPage(c)) return maintenancePage(c.req.method);
    const retry = { 'Retry-After': '30' };
    return errorResponse(c, new ApiException('UNAVAILABLE', undefined, undefined, retry));
  }
  console.error(
    JSON.stringify({
      msg: 'unhandled_error',
      requestId: c.get('requestId'),
      name: err.name,
      error: err.message,
      stack: err.stack?.split('\n').slice(0, 6).join(' | '),
    }),
  );
  return errorResponse(c, new ApiException('INTERNAL'));
}
