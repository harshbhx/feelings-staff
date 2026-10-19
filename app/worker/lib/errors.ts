/** Throw `fail('PIN_WRONG', 'Wrong PIN. 3 tries left.', { triesLeft: 3 })` from any handler or service. */
import { DEFAULT_ERROR_MESSAGES, ERROR_STATUS, type ErrorCode } from '@fs/contracts';

export class ApiException extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown> | undefined;
  readonly headers: Record<string, string> | undefined;

  constructor(
    code: ErrorCode,
    message?: string,
    details?: Record<string, unknown>,
    headers?: Record<string, string>,
  ) {
    super(message ?? DEFAULT_ERROR_MESSAGES[code]);
    this.name = 'ApiException';
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.details = details;
    this.headers = headers;
  }
}

export function fail(
  code: ErrorCode,
  message?: string,
  details?: Record<string, unknown>,
  headers?: Record<string, string>,
): never {
  throw new ApiException(code, message, details, headers);
}

export function isApiException(e: unknown): e is ApiException {
  return e instanceof ApiException;
}
