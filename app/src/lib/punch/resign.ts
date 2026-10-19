/**
 * Re-signing a queued punch after `409 NONCE_INVALID` (PRD 4.3.6, 11.5). Owner: WP-4.
 *
 * The offline queue calls the re-signer once per item. It gets a fresh nonce, then rebuilds the
 * same request (same idempotency key, same sealed PIN envelope, same fix and selfie hash) with that
 * nonce and signs it again with the device key. Nothing else in the request changes.
 */
import type { ApiClient, PunchRequest } from '@fs/contracts';
import type { PunchSigner } from './deps';
import { signPunchRequest, type UnsignedPunchRequest } from './payload';

export interface ResignDeps {
  api: Pick<ApiClient, 'punchNonce'>;
  getSigner: () => Promise<PunchSigner>;
}

/** Build the function `setResigner` in `pwa/queue.ts` expects. */
export function createPunchResigner(deps: ResignDeps) {
  return async (item: { request: PunchRequest }): Promise<PunchRequest> => {
    const res = await deps.api.punchNonce({ body: { purpose: 'punch' } });
    if (!('nonce' in res)) throw new Error('The server did not issue a punch nonce');
    const { signature: _old, ...rest } = item.request;
    const unsigned: UnsignedPunchRequest = { ...rest, nonce: res.nonce };
    return signPunchRequest(unsigned, await deps.getSigner());
  };
}
