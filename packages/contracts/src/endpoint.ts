/** Endpoint definition helpers. The table itself lives in endpoints.ts. */
import type { z } from 'zod';
import type { Permission } from './enums';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Who may call an endpoint (PRD 9.4 roles):
 * - `public`: no session.
 * - `self`: any signed-in person (staff, manager or owner) acting on their own data.
 * - `owner`: the owner.
 * - `manager`: a manager holding `perm` (when set), or any manager when `perm` is absent.
 * - `door`: a paired door device session.
 * - `test`: test-only route, preview/local with the X-E2E-Token header.
 */
export type Access = 'public' | 'self' | 'owner' | 'manager' | 'door' | 'test';

export interface EndpointShape {
  readonly method: HttpMethod;
  /** Path under /api/v1, with `:param` segments. */
  readonly path: string;
  readonly access: readonly Access[];
  /** Manager permission required when `manager` is in `access`. */
  readonly perm?: Permission;
  /** Owner PIN within the last 10 minutes (PRD 4.1.7). */
  readonly stepUp?: boolean;
  /** Accepts an `Idempotency-Key` header; a repeat returns the first response. */
  readonly idempotent?: boolean;
  /** Body is multipart: field `payload` holds the JSON, files are extra fields. */
  readonly multipart?: boolean;
  /** Response is a file (Blob on the client). */
  readonly binary?: boolean;
  /** HTTP status on success (default 200). */
  readonly status?: 200 | 201 | 202 | 204;
  readonly params?: z.ZodType;
  readonly query?: z.ZodType;
  readonly body?: z.ZodType;
  readonly res: z.ZodType;
  /** One line for docs and the 501 stub. */
  readonly summary: string;
}

/** Identity helper that keeps literal types (method, access) for inference. */
export function ep<const T extends EndpointShape>(def: T): T {
  return def;
}

type ParamsIn<E> = E extends { params: infer P extends z.ZodType }
  ? { params: z.input<P> }
  : unknown;
type QueryIn<E> = E extends { query: infer Q extends z.ZodType } ? { query: z.input<Q> } : unknown;
type BodyIn<E> = E extends { body: infer B extends z.ZodType } ? { body: z.input<B> } : unknown;
type FilesIn<E> = E extends { multipart: true } ? { files?: Record<string, Blob> } : unknown;

type ParamsOut<E> = E extends { params: infer P extends z.ZodType }
  ? { params: z.output<P> }
  : unknown;
type QueryOut<E> = E extends { query: infer Q extends z.ZodType }
  ? { query: z.output<Q> }
  : unknown;
type BodyOut<E> = E extends { body: infer B extends z.ZodType } ? { body: z.output<B> } : unknown;
type FilesOut<E> = E extends { multipart: true } ? { files: Record<string, File> } : unknown;

/** What a caller passes for endpoint E. */
export type InputOf<E> = ParamsIn<E> & QueryIn<E> & BodyIn<E> & FilesIn<E>;
/** What a server handler receives for endpoint E (after zod parsing). */
export type ParsedInputOf<E> = ParamsOut<E> & QueryOut<E> & BodyOut<E> & FilesOut<E>;
/** What the endpoint returns. */
export type OutputOf<E> = E extends { res: infer R extends z.ZodType } ? z.output<R> : never;

export type HasInput<E> = E extends
  | { params: z.ZodType }
  | { query: z.ZodType }
  | { body: z.ZodType }
  ? true
  : false;

/** Fill `:param` segments of a path. Values are URI-encoded. */
export function buildPath(
  path: string,
  params: Record<string, string | number> | undefined,
): string {
  return path.replace(/:([A-Za-z]+)/g, (_m, key: string) => {
    const v = params?.[key];
    if (v === undefined) throw new Error(`Missing path param ${key} for ${path}`);
    return encodeURIComponent(String(v));
  });
}
