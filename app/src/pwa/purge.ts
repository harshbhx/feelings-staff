/**
 * Sign-out cleanup (PRD 11.4). Owner: WP-7.
 * Deletes the personal runtime caches (`api-v1`, `selfies`, `payslips`) and clears every IndexedDB
 * store except `device` (the device key stays bound to this phone). Queued punches are dropped too,
 * so the shell should warn before signing out while the queue is not empty. Best effort, never throws.
 */
import { openFeelingsDb } from '../lib/idb';
import { USER_CACHES } from './protocol';
import { reloadQueue } from './queue';

const USER_STORES = ['timeAnchor', 'offlineNonces', 'pendingPunches', 'prefs'] as const;

export async function clearUserData(): Promise<void> {
  if (typeof caches !== 'undefined') {
    await Promise.all(USER_CACHES.map((name) => caches.delete(name).catch(() => false)));
  }
  try {
    const db = await openFeelingsDb();
    const tx = db.transaction([...USER_STORES], 'readwrite');
    await Promise.all([...USER_STORES.map((name) => tx.objectStore(name).clear()), tx.done]);
  } catch {
    // IndexedDB unavailable: nothing was stored there.
  }
  await reloadQueue();
}
