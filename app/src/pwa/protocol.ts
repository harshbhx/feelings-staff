/**
 * Names shared by the service worker and the page (PRD 11.4). Owner: WP-7.
 * Kept free of DOM and React so both the app and the SW TypeScript projects can import it.
 */

/** Runtime caches. `api-v1`, `selfies` and `payslips` hold personal data and are purged on sign-out. */
export const CACHE_API = 'api-v1';
export const CACHE_SELFIES = 'selfies';
export const CACHE_PAYSLIPS = 'payslips';
export const CACHE_TILES = 'tiles';
export const USER_CACHES = [CACHE_API, CACHE_SELFIES, CACHE_PAYSLIPS] as const;

/** Added by the SW to every cached API copy: epoch ms of when it was stored. */
export const CACHED_AT_HEADER = 'X-FS-Cached-At';

/** Posted to every window client when an API request was answered from `api-v1`. */
export const CACHED_MESSAGE = 'fs:cached';
export interface CachedMessage {
  type: typeof CACHED_MESSAGE;
  url: string;
  cachedAt: number;
}

/** Sent by the page to the waiting worker when the person taps Update. */
export const SKIP_WAITING_MESSAGE = 'SKIP_WAITING';

export function isCachedMessage(data: unknown): data is CachedMessage {
  if (!data || typeof data !== 'object') return false;
  const d = data as Partial<CachedMessage>;
  return d.type === CACHED_MESSAGE && typeof d.url === 'string' && typeof d.cachedAt === 'number';
}
