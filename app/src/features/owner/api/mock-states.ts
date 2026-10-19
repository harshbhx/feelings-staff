/**
 * Frozen loading and error states for visual tests (PRD 14.5). Only in mock mode, which runs only on
 * localhost (see app/src/api/provider.tsx): `?mock=1&variant=ownerToday:loading` keeps that query
 * pending forever (the skeleton stays), `variant=ownerToday:error` makes it fail like a dropped
 * connection. Production builds never reach this: `mockChoice()` returns null off localhost.
 */
import { ApiError, type EndpointKey } from '@fs/contracts';
import { mockChoice } from '../../../api/provider';

export type MockHold = 'loading' | 'error';

export function mockHold(key: EndpointKey): MockHold | null {
  const v = mockChoice()?.variants[key];
  return v === 'loading' || v === 'error' ? v : null;
}

/** Run a query function unless the mock asks to hold it in the loading or error state. */
export function held<T>(key: EndpointKey, run: () => Promise<T>): Promise<T> {
  const hold = mockHold(key);
  if (hold === 'loading') return new Promise<T>(() => {});
  if (hold === 'error')
    return Promise.reject(
      new ApiError({ code: 'UNAVAILABLE', status: 503, requestId: 'req_01K8VISUALTEST' }),
    );
  return run();
}

/** Mock-held errors are not retried, so the error card shows at once. */
export function retryUnlessHeld(key: EndpointKey) {
  return (failures: number) => mockHold(key) === null && failures < 1;
}
