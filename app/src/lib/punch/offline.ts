/**
 * Keeping a phone ready to punch offline (PRD 4.3.6, 10.3, 11.5). Owner: WP-4.
 *
 * WP-7 calls `ensureOfflineReady(api)` when the app opens (and `refreshTimeAnchor(api)` on app open
 * and visibility changes); the punch flow tops up after each successful online punch. Errors are
 * swallowed: being offline-ready is best effort, and a punch without it reports
 * `failed: offline_unavailable` instead of queueing.
 */
import type { ApiClient } from '@fs/contracts';
import { OFFLINE_NONCES_KEPT, type PunchStore, pagePunchStore } from './deps';
import { timeAnchorFrom } from './payload';

interface Clocks {
  now?: () => number;
  perfNow?: () => number;
}

const clocksOf = (c: Clocks) => ({
  dateNow: (c.now ?? Date.now)(),
  perfNow: (c.perfNow ?? (() => performance.now()))(),
});

/** Store a fresh signed server time (`GET /time`). Returns false when it could not. */
export async function refreshTimeAnchor(
  api: Pick<ApiClient, 'time'>,
  store: PunchStore = pagePunchStore,
  clocks: Clocks = {},
): Promise<boolean> {
  try {
    const signed = await api.time();
    await store.setTimeAnchor(timeAnchorFrom(signed, clocksOf(clocks)));
    return true;
  } catch {
    return false;
  }
}

/**
 * Make sure the store has the PIN-sealing key (`GET /config`) and two unused offline nonces
 * (`POST /punch/nonce { purpose: 'offline' }`, which also refreshes the time anchor).
 */
export async function ensureOfflineReady(
  api: Pick<ApiClient, 'config' | 'punchNonce'>,
  store: PunchStore = pagePunchStore,
  clocks: Clocks = {},
): Promise<void> {
  try {
    if (!(await store.getPunchKey())) {
      const config = await api.config();
      await store.setPunchKey(config.punchEncPublicJwk as JsonWebKey);
    }
  } catch {
    // Try again next time.
  }
  try {
    const now = (clocks.now ?? Date.now)();
    if ((await store.offlineNonceCount(now)) >= OFFLINE_NONCES_KEPT) return;
    const res = await api.punchNonce({ body: { purpose: 'offline' } });
    if ('nonces' in res) {
      await store.putOfflineNonces(res.nonces);
      await store.setTimeAnchor(timeAnchorFrom(res, clocksOf(clocks)));
    }
  } catch {
    // Try again next time.
  }
}
