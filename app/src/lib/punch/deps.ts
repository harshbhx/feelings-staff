/**
 * Ports the punch flow depends on, injected so tests can fake them and so WP-4 does not wait on
 * modules other packages are still building:
 *
 * - `PunchSigner`: the device key. WP-3's `app/src/lib/device-key.ts` (`sign()`, ECDSA P-256,
 *   IEEE P1363, base64url) plus the server device id from `Me.device.id`. Until it is wired, the
 *   default `deviceSignerStub` throws `PunchDependencyMissing('device-key')`.
 * - `PunchQueue`: WP-7's offline queue `app/src/pwa/queue.ts` (`enqueue`). Until it is wired, the
 *   default `punchQueueStub` throws `PunchDependencyMissing('queue')`.
 * - `PunchStore`: the time anchor, offline nonces and the offline PIN key. These belong in WP-3's
 *   `feelings` IndexedDB (`timeAnchor`, `offlineNonces`, `prefs`); until `idb.ts` lands the default
 *   is an in-memory store that lasts for the page.
 */
import type { PunchRequest } from '@fs/contracts';

/** The device key, as the punch flow needs it. */
export interface PunchSigner {
  /** Server id of this phone (`Me.device.id`), signed into every punch. */
  readonly deviceId: string;
  /** ECDSA P-256/SHA-256 over the UTF-8 message; base64url IEEE P1363 signature. */
  sign(message: string): Promise<string>;
}

/**
 * What the flow hands to the offline queue (PRD 4.3.6, 11.5). `request` is fully signed, has an
 * offline nonce, `pin: null` and the sealed PIN in `offline.pinEnvelope`; the plain PIN is never
 * part of it (S-09.4). The queue sends it with `Idempotency-Key: idempotencyKey` and the selfie as
 * the multipart file `selfie`, and deletes the blob once uploaded.
 */
export interface QueuedPunch {
  idempotencyKey: string;
  request: PunchRequest;
  selfie: Blob | null;
}

export interface PunchQueue {
  enqueue(item: QueuedPunch): Promise<void>;
}

/** Signed server time and the local clocks when it arrived (PRD 4.3.6, 11.5 `timeAnchor`). */
export interface TimeAnchor {
  serverTime: number;
  timeSig: string;
  /** performance.now() when the anchor was received. */
  perfNow: number;
  /** Date.now() when the anchor was received. */
  dateNow: number;
  /** perfNow is only comparable within the same page session. */
  pageSessionId: string;
}

/** A pre-issued single-use nonce for offline punches (PRD 11.5 `offlineNonces`). */
export interface OfflineNonce {
  nonce: string;
  expiresAt: number;
}

export interface PunchStore {
  getTimeAnchor(): Promise<TimeAnchor | null>;
  setTimeAnchor(anchor: TimeAnchor): Promise<void>;
  /** Remove and return the oldest offline nonce the server still accepts at `now`, or null. */
  takeOfflineNonce(now: number): Promise<OfflineNonce | null>;
  /** Add nonces (keeps the newest `OFFLINE_NONCES_KEPT`). */
  putOfflineNonces(nonces: readonly OfflineNonce[]): Promise<void>;
  offlineNonceCount(now: number): Promise<number>;
  /** `PublicConfig.punchEncPublicJwk`, kept so a punch can be sealed while offline. */
  getPunchKey(): Promise<JsonWebKey | null>;
  setPunchKey(jwk: JsonWebKey): Promise<void>;
}

const HOUR_MS = 3_600_000;
export const OFFLINE_NONCES_KEPT = 2;
/** Offline nonces are issued for 24 h, and the server accepts an unused one up to 7 days after issue. */
export const OFFLINE_NONCE_TTL_MS = 24 * HOUR_MS;
export const OFFLINE_NONCE_ACCEPTED_MS = 7 * 24 * HOUR_MS;

/** Whether the server still accepts this offline nonce at `now`. */
export function offlineNonceUsable(n: OfflineNonce, now: number): boolean {
  const issuedAt = n.expiresAt - OFFLINE_NONCE_TTL_MS;
  return now <= issuedAt + OFFLINE_NONCE_ACCEPTED_MS;
}

export class PunchDependencyMissing extends Error {
  readonly dependency: 'device-key' | 'queue';
  constructor(dependency: 'device-key' | 'queue') {
    super(
      dependency === 'device-key'
        ? 'Punch signing needs the device key (WP-3 app/src/lib/device-key.ts); it is not wired yet.'
        : 'Offline punches need the queue (WP-7 app/src/pwa/queue.ts); it is not wired yet.',
    );
    this.name = 'PunchDependencyMissing';
    this.dependency = dependency;
  }
}

/** Default signer until WP-3's device key is wired: always throws. */
export async function deviceSignerStub(): Promise<PunchSigner> {
  throw new PunchDependencyMissing('device-key');
}

/** Default queue until WP-7's queue is wired: always throws. */
export const punchQueueStub: PunchQueue = {
  async enqueue() {
    throw new PunchDependencyMissing('queue');
  },
};

/** In-memory PunchStore (tests, and the default until WP-3's `idb.ts` is wired). */
export function createMemoryPunchStore(): PunchStore {
  let anchor: TimeAnchor | null = null;
  let key: JsonWebKey | null = null;
  let nonces: OfflineNonce[] = [];
  return {
    async getTimeAnchor() {
      return anchor;
    },
    async setTimeAnchor(a) {
      anchor = { ...a };
    },
    async takeOfflineNonce(now) {
      nonces = nonces.filter((n) => offlineNonceUsable(n, now));
      nonces.sort((a, b) => a.expiresAt - b.expiresAt);
      return nonces.shift() ?? null;
    },
    async putOfflineNonces(add) {
      const seen = new Set(nonces.map((n) => n.nonce));
      const merged = [...nonces, ...add.filter((n) => !seen.has(n.nonce))];
      merged.sort((a, b) => a.expiresAt - b.expiresAt);
      nonces = merged.slice(-OFFLINE_NONCES_KEPT);
    },
    async offlineNonceCount(now) {
      return nonces.filter((n) => offlineNonceUsable(n, now)).length;
    },
    async getPunchKey() {
      return key;
    },
    async setPunchKey(jwk) {
      key = { ...jwk };
    },
  };
}

/** One store per page, so anchors, nonces and the key survive between check-in sheets. */
export const pagePunchStore: PunchStore = createMemoryPunchStore();
