/**
 * Stale-chunk recovery. After a redeploy a phone can hold an old shell that points at a hashed file
 * the new deploy no longer has. Instead of an error page, the app drops its shell caches and the
 * service worker once, then reloads, and the fresh shell loads the current files.
 */
export const CHUNK_ERROR = /dynamically imported module|Importing a module script failed/i; // Chrome/Edge, Firefox, Safari
export const RELOAD_KEY = 'fs.chunk-reload';
/** Only one recovery reload per session; a second failure inside this window shows the error page. */
export const RELOAD_WINDOW_MS = 10 * 60 * 1000;

export function isChunkError(error: unknown): boolean {
  return CHUNK_ERROR.test(String((error as Error | undefined)?.message ?? error));
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

/** Unregisters the service worker and deletes the precached shell (API and media caches stay). */
async function dropShell(): Promise<void> {
  const regs = await navigator.serviceWorker?.getRegistrations();
  await Promise.all(regs?.map((r) => r.unregister()) ?? []);
  const keys = await caches.keys();
  await Promise.all(keys.filter((k) => k.includes('precache')).map((k) => caches.delete(k)));
}

/** Reloads once with clean shell caches. Returns false when the guard says it already did. */
export function recoverFromStaleChunk(): boolean {
  if (!claimReload(sessionStorage, Date.now())) return false;
  dropShell()
    .catch(() => undefined)
    .then(() => window.location.reload());
  return true;
}

/** Vite fires this when a `import()` preload fails (before React Router sees the error). */
export function installChunkReload(): void {
  window.addEventListener('vite:preloadError', (event) => {
    if (recoverFromStaleChunk()) event.preventDefault();
  });
}
