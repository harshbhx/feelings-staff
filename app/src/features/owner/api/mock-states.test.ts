import { ApiError, type ErrorCode } from '@fs/contracts';
import { describe, expect, it } from 'vitest';
import { errorKey } from '../components/states';
import { worthRetrying } from './mock-states';

const fail = (code: ErrorCode, status: number) => new ApiError({ code, status });

describe('owner queries against the real API (PRD 5 shared states)', () => {
  it('retries a dropped connection or a busy server once', () => {
    expect(worthRetrying(new TypeError('Failed to fetch'))).toBe(true);
    expect(worthRetrying(fail('UNAVAILABLE', 503))).toBe(true);
    expect(worthRetrying(fail('INTERNAL', 500))).toBe(true);
  });

  it('does not retry answers that a second try cannot change', () => {
    expect(worthRetrying(fail('NOT_IMPLEMENTED', 501))).toBe(false);
    expect(worthRetrying(fail('NOT_FOUND', 404))).toBe(false);
    expect(worthRetrying(fail('FORBIDDEN', 403))).toBe(false);
    expect(worthRetrying(fail('STEP_UP_REQUIRED', 403))).toBe(false);
  });

  it('says in plain words when a part of the server is not built yet', () => {
    expect(errorKey(fail('NOT_IMPLEMENTED', 501))).toBe('owner:errors.notReady');
    expect(errorKey(fail('INTERNAL', 500))).toBe('owner:errors.server');
    expect(errorKey(fail('PAYLOAD_TOO_LARGE', 413))).toBe('owner:errors.generic');
    expect(errorKey(new TypeError('Failed to fetch'))).toBe('owner:errors.network');
  });
});
