/**
 * The real implementations of the punch flow ports: WP-3's device key, WP-7's offline queue and
 * the `feelings` IndexedDB (stores `timeAnchor`, `offlineNonces`, `prefs`). Kept apart from
 * `deps.ts` so unit tests and the pure modules never import IndexedDB or the queue.
 */

import { enqueue } from '../../pwa/queue';
import { getDeviceRecord, sign } from '../device-key';
import { openFeelingsDb } from '../idb';
import {
  OFFLINE_NONCES_KEPT,
  type OfflineNonce,
  offlineNonceUsable,
  type PunchQueue,
  type PunchSigner,
  type PunchStore,
} from './deps';

const PUNCH_KEY_PREF = 'punchEncPublicJwk';

/** The device key plus the server id of this phone (`DeviceRecord.deviceId`). */
export async function deviceSigner(): Promise<PunchSigner> {
  const record = await getDeviceRecord();
  if (!record?.deviceId) throw new Error('This phone has no approved device key yet');
  return { deviceId: record.deviceId, sign };
}

export const appPunchQueue: PunchQueue = {
  async enqueue(item) {
    await enqueue(item.request, item.selfie);
  },
};

export const idbPunchStore: PunchStore = {
  async getTimeAnchor() {
    return (await (await openFeelingsDb()).get('timeAnchor', 'current')) ?? null;
  },
  async setTimeAnchor(anchor) {
    await (await openFeelingsDb()).put('timeAnchor', anchor, 'current');
  },
  async takeOfflineNonce(now) {
    const db = await openFeelingsDb();
    const tx = db.transaction('offlineNonces', 'readwrite');
    const all = await tx.store.index('byExpiresAt').getAll();
    const usable = all.filter((n) => offlineNonceUsable(n, now));
    const pick = usable[0];
    if (pick) await tx.store.delete(pick.nonce);
    await tx.done;
    return pick ?? null;
  },
  async putOfflineNonces(add: readonly OfflineNonce[]) {
    const db = await openFeelingsDb();
    const tx = db.transaction('offlineNonces', 'readwrite');
    for (const n of add) await tx.store.put({ ...n });
    const all = await tx.store.index('byExpiresAt').getAll();
    for (const old of all.slice(0, Math.max(0, all.length - OFFLINE_NONCES_KEPT))) {
      await tx.store.delete(old.nonce);
    }
    await tx.done;
  },
  async offlineNonceCount(now) {
    const all = await (await openFeelingsDb()).getAll('offlineNonces');
    return all.filter((n) => offlineNonceUsable(n, now)).length;
  },
  async getPunchKey() {
    const v = await (await openFeelingsDb()).get('prefs', PUNCH_KEY_PREF);
    return (v as JsonWebKey | undefined) ?? null;
  },
  async setPunchKey(jwk) {
    await (await openFeelingsDb()).put('prefs', jwk, PUNCH_KEY_PREF);
  },
};
