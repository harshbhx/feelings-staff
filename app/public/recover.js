/*
 * Stale-chunk recovery. Loaded by a plain script tag (not part of the hashed bundle, so a redeploy
 * can never delete it and the staff initial JS budget is untouched). After a redeploy a phone can
 * hold an old shell that points at a file the new deploy no longer has: drop the precached shell and
 * the service worker once, then reload, so the fresh shell loads the current files.
 * window.__fsRecover(error?) is also called by the route error page; with an error it only acts
 * when the message is a chunk-load failure. Returns true when it started a reload.
 */
((w) => {
  const KEY = 'fs.chunk-reload';
  const WINDOW_MS = 10 * 60 * 1000;
  const CHUNK = /dynamically imported module|Importing a module script failed/i;
  function claim() {
    try {
      const now = Date.now();
      const last = Number(w.sessionStorage.getItem(KEY));
      if (last > 0 && now - last < WINDOW_MS) return false;
      w.sessionStorage.setItem(KEY, String(now));
      return true;
    } catch {
      return false; // no storage means no guard, and a reload loop is worse than the error page
    }
  }
  function recover(error) {
    if (error !== undefined && !CHUNK.test(String(error?.message || error))) return false;
    if (!claim()) return false;
    const regs = w.navigator.serviceWorker
      ? w.navigator.serviceWorker.getRegistrations()
      : Promise.resolve([]);
    regs
      .then((all) => Promise.all(all.map((r) => r.unregister())))
      .then(() => w.caches.keys())
      .then((keys) =>
        Promise.all(keys.filter((k) => k.indexOf('precache') >= 0).map((k) => w.caches.delete(k))),
      )
      .catch(() => {})
      .then(() => {
        w.location.reload();
      });
    return true;
  }
  w.__fsRecover = recover;
  w.addEventListener('vite:preloadError', (event) => {
    if (recover()) event.preventDefault();
  });
})(window);
