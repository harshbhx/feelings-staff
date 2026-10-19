/** Maps any thrown error to the PRD 9.2 shape. Never leaks stack traces. */
import type { ApiErrorBody } from '@fs/contracts';
import type { Context } from 'hono';
import type { AppEnv } from '../lib/app-env';
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

export function onError(err: Error, c: Context<AppEnv>): Response {
  if (isApiException(err)) return errorResponse(c, err);
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
