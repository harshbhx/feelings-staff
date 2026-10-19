/**
 * HttpApiClient: implements ApiClient from the contract table (WP-1). Same-origin cookies,
 * X-FS-Client on every call, Idempotency-Key on idempotent endpoints, errors as ApiError.
 */
import {
  API_BASE,
  type ApiClient,
  ApiError,
  type ApiErrorBody,
  buildPath,
  type CallOptions,
  type EndpointKey,
  ERROR_STATUS,
  type ErrorCode,
} from '@fs/contracts';
import { ROUTES } from './routes.gen';

export interface HttpClientOptions {
  appVersion: string;
  /** Origin to call; '' for same origin. */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Called on 401 (session gone) and 426 (update needed) so the app can react globally. */
  onAuthLost?: () => void;
  onUpgradeRequired?: () => void;
}

type Input = {
  params?: Record<string, string | number>;
  query?: Record<string, unknown>;
  body?: unknown;
  files?: Record<string, Blob>;
};

function queryString(q: Record<string, unknown> | undefined): string {
  if (!q) return '';
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null) continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

/** Shape check for the error body (PRD 9.2) without zod, which stays out of the client shell. */
function isErrorBody(v: unknown): v is ApiErrorBody {
  if (typeof v !== 'object' || v === null) return false;
  const e = (v as { error?: unknown }).error;
  if (typeof e !== 'object' || e === null) return false;
  const { code, message } = e as { code?: unknown; message?: unknown };
  return typeof code === 'string' && code in ERROR_STATUS && typeof message === 'string';
}

function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export function createHttpApiClient(opts: HttpClientOptions): ApiClient {
  const base = opts.baseUrl ?? '';
  const doFetch = opts.fetchImpl ?? fetch.bind(globalThis);
  const client: Record<string, unknown> = {};

  const url = (key: EndpointKey, input?: Input) =>
    `${base}${API_BASE}${buildPath(ROUTES[key].p, input?.params)}${queryString(input?.query)}`;

  for (const key of Object.keys(ROUTES) as EndpointKey[]) {
    const def = ROUTES[key];
    client[key] = async (input: Input | undefined, callOpts: CallOptions = {}) => {
      const headers: Record<string, string> = {
        'X-FS-Client': opts.appVersion,
        ...(callOpts.headers ?? {}),
      };
      if (def.i) headers['Idempotency-Key'] = callOpts.idempotencyKey ?? newIdempotencyKey();
      let body: BodyInit | undefined;
      if (def.mp) {
        const form = new FormData();
        form.set('payload', JSON.stringify(input?.body ?? {}));
        for (const [name, blob] of Object.entries(input?.files ?? {}))
          form.set(name, blob, `${name}.jpg`);
        body = form;
      } else if (input?.body !== undefined) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(input.body);
      }
      let res: Response;
      try {
        res = await doFetch(url(key, input), {
          method: def.m,
          headers,
          credentials: 'same-origin',
          ...(body !== undefined ? { body } : {}),
          ...(callOpts.signal ? { signal: callOpts.signal } : {}),
        });
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') throw e;
        throw new ApiError({ code: 'UNAVAILABLE', status: 0 });
      }
      if (!res.ok) {
        let parsed: ApiErrorBody | null = null;
        try {
          const body: unknown = await res.json();
          parsed = isErrorBody(body) ? body : null;
        } catch {
          parsed = null;
        }
        const code: ErrorCode =
          parsed?.error.code ?? (res.status >= 500 ? 'UNAVAILABLE' : 'BAD_REQUEST');
        if (res.status === 401 && code === 'UNAUTHENTICATED') opts.onAuthLost?.();
        if (res.status === 426) opts.onUpgradeRequired?.();
        throw new ApiError({
          code,
          status: res.status,
          message: parsed?.error.message,
          details: parsed?.error.details,
          requestId: parsed?.error.requestId ?? res.headers.get('X-Request-Id') ?? undefined,
        });
      }
      if (def.b) return res.blob();
      if (res.status === 204 || res.status === 202 || def.s === 204) return undefined;
      return res.json();
    };
  }
  client.url = url;
  return client as unknown as ApiClient;
}
