/**
 * The paired door device, kept in its own IndexedDB database `feelings-door` (separate from the
 * staff app's `feelings`, which is wiped on sign-out). The secret stays on this device only.
 */
import { type DBSchema, openDB } from 'idb';

export interface DoorPairing {
  doorDeviceId: string;
  siteId: string;
  siteName: string;
  /** base64url, 32 bytes. */
  secret: string;
}

export interface DoorStore {
  get(): Promise<DoorPairing | null>;
  set(p: DoorPairing): Promise<void>;
  clear(): Promise<void>;
}

interface DoorDB extends DBSchema {
  door: { key: string; value: DoorPairing };
}

const KEY = 'current';

export const idbDoorStore: DoorStore = (() => {
  const db = () =>
    openDB<DoorDB>('feelings-door', 1, {
      upgrade(d) {
        d.createObjectStore('door');
      },
    });
  return {
    async get() {
      try {
        return (await (await db()).get('door', KEY)) ?? null;
      } catch {
        return null;
      }
    },
    async set(p) {
      await (await db()).put('door', p, KEY);
    },
    async clear() {
      await (await db()).delete('door', KEY);
    },
  };
})();

export function createMemoryDoorStore(initial: DoorPairing | null = null): DoorStore {
  let v = initial;
  return {
    async get() {
      return v;
    },
    async set(p) {
      v = p;
    },
    async clear() {
      v = null;
    },
  };
}
