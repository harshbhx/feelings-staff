/** The ApiClient interface: one method per endpoint in the table (PRD 16.3). */
import type { HasInput, InputOf, OutputOf } from './endpoint';
import type { EndpointKey, Endpoints } from './endpoints';
import { DEFAULT_ERROR_MESSAGES, type ErrorCode } from './error-codes';

export interface CallOptions {
  /** Sent as `Idempotency-Key` on endpoints marked idempotent (generated if absent). */
  idempotencyKey?: string;
  signal?: AbortSignal;
  /** Extra headers (e.g. `X-Setup-Token`, `X-E2E-Token`). */
  headers?: Record<string, string>;
}

export type ClientMethod<E> =
  HasInput<E> extends true
    ? (input: InputOf<E>, opts?: CallOptions) => Promise<OutputOf<E>>
    : (input?: undefined, opts?: CallOptions) => Promise<OutputOf<E>>;

export type ApiClient = { [K in EndpointKey]: ClientMethod<Endpoints[K]> } & {
  /** Absolute path (with /api/v1) for links and downloads, e.g. the payslip PDF. */
  url<K extends EndpointKey>(key: K, input?: InputOf<Endpoints[K]>): string;
};

/** Thrown by every client for a non-2xx answer. `code` drives translated copy. */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown> | undefined;
  readonly requestId: string | undefined;

  constructor(init: {
    code: ErrorCode;
    status: number;
    message?: string | undefined;
    details?: Record<string, unknown> | undefined;
    requestId?: string | undefined;
  }) {
    super(init.message ?? DEFAULT_ERROR_MESSAGES[init.code]);
    this.name = 'ApiError';
    this.code = init.code;
    this.status = init.status;
    this.details = init.details;
    this.requestId = init.requestId;
  }
}

export function isApiError(e: unknown, code?: ErrorCode): e is ApiError {
  return e instanceof ApiError && (code === undefined || e.code === code);
}

export const API_BASE = '/api/v1';
