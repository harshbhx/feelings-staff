/**
 * Preview-only endpoints (`previewOnly` in the endpoint table, the owner demo-data buttons). Only
 * `ENV === 'preview'` has them; production, local and an unset ENV answer 404 NOT_FOUND, exactly
 * like an unknown route. The check runs in a middleware mounted before the session is read and
 * again in the route (registerApi), so no handler or database call is reached by mistake.
 */
import { ENDPOINT_KEYS, type EndpointShape, endpoints } from '@fs/contracts';
import type { MiddlewareHandler } from 'hono';
import type { Env } from '../env';
import { errorResponse } from '../middleware/errors';
import type { AppEnv } from './app-env';
import { ApiException, fail } from './errors';

export function isPreviewEnv(env: Pick<Env, 'ENV'>): boolean {
  return env.ENV === 'preview';
}

/** Throws the same NOT_FOUND an unknown route gets, unless this is a preview. */
export function requirePreview(env: Pick<Env, 'ENV'>): void {
  if (!isPreviewEnv(env)) fail('NOT_FOUND');
}

export const previewOnlyGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!isPreviewEnv(c.env)) return errorResponse(c, new ApiException('NOT_FOUND'));
  return next();
};

/** Endpoints flagged `previewOnly` in the contract table. */
export const PREVIEW_ONLY_KEYS = ENDPOINT_KEYS.filter(
  (k) => (endpoints[k] as EndpointShape).previewOnly === true,
);
