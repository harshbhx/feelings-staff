/**
 * Stale-chunk recovery. After a redeploy a phone can hold an old shell that points at a hashed file
 * the new deploy no longer has. Instead of an error page, the app drops its shell caches and the
 * service worker once, then reloads, and the fresh shell loads the current files.
 */
import { USER_CACHES } from './protocol';

export const CHUNK_ERROR =
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i;
export const RELOAD_KEY = 'fs.chunk-reload';
/** Only one recovery reload per session; a second failure inside this window shows the error page. */
export const RELOAD_WINDOW_MS = 10 * 60 * 1000;

export function isChunkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return CHUNK_ERROR.test(message);
}

/** True once per session (claims the slot); false when a reload already happened recently. */
export function claimReload(storage: Pick<Storage, 'getItem' | 'setItem'>, now: number): boolean {
  try {
    const last = Number(storage.getItem(RELOAD_KEY));
    if (last > 0 && now - last < RELOAD_WINDOW_MS) return false;
    storage.setItem(RELOAD_KEY, String(now));
    return true;
  } catch {
    return false; // no storage means no guard, and a reload loop is worse than the error page
  }
}

async function dropShell(): Promise<void> {
  const keep: string[] = [...USER_CACHES, 'tiles'];
  await Promise.all([
    navigator.serviceWorker
      ?.getRegistrations()
      .then((all) => Promise.all(all.map((r) => r.unregister()))),
    globalThis.caches
      ?.keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !keep.includes(k)).map((k) => caches.delete(k))),
      ),
  ]).catch(() => undefined);
}

/** Reloads once with clean shell caches. Returns false when the guard says it already did. */
export function recoverFromStaleChunk(): boolean {
  if (!claimReload(sessionStorage, Date.now())) return false;
  void dropShell().then(() => window.location.reload());
  return true;
}

/** Vite fires this when a `import()` preload fails (before React Router sees the error). */
export function installChunkReload(): void {
  window.addEventListener('vite:preloadError', (event) => {
    if (recoverFromStaleChunk()) event.preventDefault();
  });
}
