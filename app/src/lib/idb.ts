/**
 * The app's IndexedDB (PRD 11.5): database `feelings`, version 1, with every store the app uses.
 * Owner: WP-3. WP-4 (punch queue, offline nonces) and WP-7 (time anchor, prefs) reuse it; a new
 * store or index needs a version bump here, never a second database.
 *
 * | Store            | Key              | Content                                                   |
 * |------------------|------------------|-----------------------------------------------------------|
 * | `device`         | `"current"`      | non-extractable device key, its public JWK, server id     |
 * | `timeAnchor`     | `"current"`      | last signed server time and the local clocks at that time |
 * | `offlineNonces`  | nonce            | `{ nonce, expiresAt }` (2 kept)                           |
 * | `pendingPunches` | idempotencyKey   | signed PunchRequest + selfie Blob + retry state           |
 * | `prefs`          | key              | language, dismissed tips                                  |
 */
import type { PunchRequest } from '@fs/contracts';
import { type DBSchema, type IDBPDatabase, openDB } from 'idb';

export const FEELINGS_DB_NAME = 'feelings';
export const FEELINGS_DB_VERSION = 1;

/** The device key record (PRD 11.5). `privateKey` is a non-extractable CryptoKey. */
export interface DeviceRecord {
  /** Server id of this device, known after join/new-device; null before. */
  deviceId: string | null;
  privateKey: CryptoKey;
  publicJwk: JsonWebKey;
  /** Last known approval state (the server is the source of truth). */
  approved: boolean;
  createdAt: number;
}

/** Signed server time anchor for offline punches (PRD 4.3.6). */
export interface TimeAnchor {
  serverTime: number;
  timeSig: string;
  /** performance.now() when the anchor was received. */
  perfNow: number;
  /** Date.now() when the anchor was received. */
  dateNow: number;
  /** Random id of the page session; perfNow is only comparable within one session. */
  pageSessionId: string;
}

export interface OfflineNonce {
  nonce: string;
  expiresAt: number;
}

/** A punch waiting to be sent (PRD 11.5 flush algorithm). */
export interface PendingPunch {
  idempotencyKey: string;
  request: PunchRequest;
  selfie: Blob | null;
  attempts: number;
  lastError: { status: number; code: string; message: string } | null;
  /** Marked failed on a 4xx other than 401/409-nonce; the chain stops for this person. */
  failed: boolean;
  createdAt: number;
  /** Earliest time for the next attempt (back-off 30 s, 2 min, 5 min). */
  nextAttemptAt: number;
}

export interface FeelingsDB extends DBSchema {
  device: { key: 'current'; value: DeviceRecord };
  timeAnchor: { key: 'current'; value: TimeAnchor };
  offlineNonces: { key: string; value: OfflineNonce; indexes: { byExpiresAt: number } };
  pendingPunches: { key: string; value: PendingPunch; indexes: { byCreatedAt: number } };
  prefs: { key: string; value: unknown };
}

export type FeelingsDb = IDBPDatabase<FeelingsDB>;

let dbPromise: Promise<FeelingsDb> | null = null;

/** True when this browser exposes IndexedDB at all (private modes may still refuse to open it). */
export function indexedDbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

/**
 * Open (once per page) the `feelings` database, creating every store on first use.
 * Rejects when IndexedDB is unavailable or blocked (old browsers, some private modes).
 */
export function openFeelingsDb(): Promise<FeelingsDb> {
  if (!dbPromise) {
    if (!indexedDbAvailable()) return Promise.reject(new Error('IndexedDB is not available'));
    dbPromise = openDB<FeelingsDB>(FEELINGS_DB_NAME, FEELINGS_DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore('device');
          db.createObjectStore('timeAnchor');
          db.createObjectStore('offlineNonces', { keyPath: 'nonce' }).createIndex(
            'byExpiresAt',
            'expiresAt',
          );
          db.createObjectStore('pendingPunches', { keyPath: 'idempotencyKey' }).createIndex(
            'byCreatedAt',
            'createdAt',
          );
          db.createObjectStore('prefs');
        }
      },
      blocking() {
        // A newer version is opening in another tab: let it upgrade.
        void dbPromise?.then((db) => db.close());
        dbPromise = null;
      },
      terminated() {
        dbPromise = null;
      },
    }).catch((e: unknown) => {
      dbPromise = null;
      throw e;
    });
  }
  return dbPromise;
}

/** Read one preference (language, dismissed tips). Returns `fallback` when missing or unreadable. */
export async function getPref<T>(key: string, fallback: T): Promise<T> {
  try {
    const db = await openFeelingsDb();
    const v = await db.get('prefs', key);
    return v === undefined ? fallback : (v as T);
  } catch {
    return fallback;
  }
}

/** Store one preference. Failures are ignored (prefs are conveniences, never required). */
export async function setPref(key: string, value: unknown): Promise<void> {
  try {
    const db = await openFeelingsDb();
    await db.put('prefs', value, key);
  } catch {
    // storage unavailable: the preference lasts for this page only
  }
}

/** Test hook: forget the open connection (the next call opens a fresh one). */
export function resetFeelingsDbForTests(): void {
  dbPromise = null;
}
