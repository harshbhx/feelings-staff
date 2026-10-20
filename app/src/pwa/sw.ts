/// <reference lib="webworker" />
/**
 * Service worker entry (PRD 11.4, 11.6, 11.7). Owner: WP-7.
 * Built by vite-plugin-pwa with `injectManifest` (see build/pwa.ts) into `/sw.js`.
 *
 * - App shell precached; navigations are network-first (3 s) and fall back to the precached index.html except /api, /v, /q, /__kit, /__test.
 * - Runtime caches exactly as PRD 11.4. Cached API copies carry `X-FS-Cached-At`; when a request is
 *   answered from that cache the SW posts `{ type: 'fs:cached', url, cachedAt }` to every window.
 * - Every other /api request is not intercepted (network only). Punches use the app-level queue
 *   (src/pwa/queue.ts), never Background Sync.
 * - No skipWaiting on install: the page asks for it (`SKIP_WAITING`) when the person taps Update.
 * - Push: ./sw/push-handlers.ts (WP-8) is picked up automatically when it exists; until then a
 *   fallback always shows a notification so Safari never counts a silent push.
 */
import { clientsClaim, type WorkboxPlugin } from 'workbox-core';
import { ExpirationPlugin } from 'workbox-expiration';
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  type PrecacheEntry,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies';
import {
  CACHE_API,
  CACHE_PAYSLIPS,
  CACHE_SELFIES,
  CACHE_TILES,
  CACHED_AT_HEADER,
  CACHED_MESSAGE,
  type CachedMessage,
  SKIP_WAITING_MESSAGE,
} from './protocol';

declare let self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<PrecacheEntry | string> };

/** Vite's `import.meta.glob`, typed locally because tsconfig.sw.json loads no ambient types. */
declare global {
  interface ImportMeta {
    glob<M>(pattern: string, options: { eager: true }): Record<string, M>;
  }
}

const DAY_S = 24 * 60 * 60;

/**
 * Workbox declares ExpirationPlugin's hooks as `WorkboxPlugin['x']` (which includes undefined), so
 * under exactOptionalPropertyTypes it is not assignable to WorkboxPlugin; the runtime shape is.
 */
function expiration(maxEntries: number, maxAgeSeconds?: number): WorkboxPlugin {
  return new ExpirationPlugin(
    maxAgeSeconds === undefined ? { maxEntries } : { maxEntries, maxAgeSeconds },
  ) as unknown as WorkboxPlugin;
}

/** GET endpoints kept for offline reading (PRD 11.4). `/me/payslips` is the list only. */
const API_CACHED =
  /^\/api\/v1\/(?:me|me\/today|me\/days(?:\/.*)?|me\/leave|me\/payslips|owner\/today|owner\/register(?:\/.*)?)$/;
const SELFIE = /^\/api\/v1\/owner\/punches\/[^/]+\/selfie$/;
const PAYSLIP_PDF = /^\/api\/v1\/payslips\/[^/]+\/pdf$/;
const TILE_ORIGIN = 'https://tile.openstreetmap.org';

/** Paths the navigation fallback must leave to the network (Worker routes and test hooks). */
const NAVIGATION_DENYLIST = [/^\/(?:api|v|q)(?:[/?]|$)/, /^\/__(?:kit|test)(?:[/?]|$)/];

// ---- Lifecycle ---------------------------------------------------------------------------------

self.addEventListener('message', (event) => {
  const data: unknown = event.data;
  if (
    data &&
    typeof data === 'object' &&
    (data as { type?: unknown }).type === SKIP_WAITING_MESSAGE
  )
    void self.skipWaiting();
});

// Take control of pages that loaded before the first install; updates still wait for SKIP_WAITING.
clientsClaim();

// ---- App shell ---------------------------------------------------------------------------------

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
const precachedShell = createHandlerBoundToURL('/index.html');
const SHELL_TIMEOUT_MS = 3000;

/**
 * Navigations are network-first (3 s) so a phone with an old precached shell gets the current one
 * whenever it is online; the precached shell only answers offline or on a slow network. A reply that
 * is not HTML (an error page) never replaces the shell.
 */
registerRoute(
  new NavigationRoute(
    async (options) => {
      try {
        const timeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('shell timeout')), SHELL_TIMEOUT_MS),
        );
        const res = await Promise.race([fetch(options.request), timeout]);
        if (res.ok && res.headers.get('Content-Type')?.includes('text/html')) return res;
      } catch {
        // offline or slow: fall through to the precached shell
      }
      return precachedShell(options);
    },
    { denylist: NAVIGATION_DENYLIST },
  ),
);

// ---- API reads: NetworkFirst, 3 s, stamped with the time they were cached -------------------------

/** Stores only 200s, each with `X-FS-Cached-At` (replaces Workbox's default 200/opaque filter). */
const stampCachedAt: WorkboxPlugin = {
  async cacheWillUpdate({ response }) {
    if (response.status !== 200) return null;
    const headers = new Headers(response.headers);
    headers.set(CACHED_AT_HEADER, String(Date.now()));
    return new Response(await response.blob(), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};

const apiStrategy = new NetworkFirst({
  cacheName: CACHE_API,
  networkTimeoutSeconds: 3,
  plugins: [stampCachedAt, expiration(50, 7 * DAY_S)],
});

async function notifyCached(url: string, cachedAt: number): Promise<void> {
  const message: CachedMessage = { type: CACHED_MESSAGE, url, cachedAt };
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of windows) client.postMessage(message);
}

registerRoute(
  ({ url, sameOrigin }) => sameOrigin && API_CACHED.test(url.pathname),
  async (options) => {
    const response = await apiStrategy.handle(options);
    // Network answers never carry the header; only copies served from `api-v1` do.
    const cachedAt = Number(response.headers.get(CACHED_AT_HEADER));
    if (cachedAt > 0) options.event.waitUntil(notifyCached(options.request.url, cachedAt));
    return response;
  },
);

// ---- Media -------------------------------------------------------------------------------------

registerRoute(
  ({ url, sameOrigin }) => sameOrigin && SELFIE.test(url.pathname),
  new StaleWhileRevalidate({
    cacheName: CACHE_SELFIES,
    plugins: [expiration(200, 7 * DAY_S)],
  }),
);

registerRoute(
  ({ url, sameOrigin }) => sameOrigin && PAYSLIP_PDF.test(url.pathname),
  new CacheFirst({
    cacheName: CACHE_PAYSLIPS,
    plugins: [expiration(24)],
  }),
);

registerRoute(
  ({ url }) => url.origin === TILE_ORIGIN,
  new CacheFirst({
    cacheName: CACHE_TILES,
    plugins: [expiration(300, 30 * DAY_S)],
  }),
);

// ---- Push seam (WP-8) --------------------------------------------------------------------------

interface PushHandlersModule {
  registerPushHandlers?: (scope: ServiceWorkerGlobalScope) => void;
}

// Eager: importing the module runs its top-level addEventListener calls. Empty until WP-8 adds it.
const pushModule = Object.values(
  import.meta.glob<PushHandlersModule>('./sw/push-handlers.ts', { eager: true }),
)[0];

/**
 * Fallback notification until WP-8's handlers ship. Not translated on purpose: the SW has no i18n,
 * and WP-8's handlers replace this with the server-sent, localised text (PRD 11.6).
 */
const FALLBACK_NOTIFICATION = { title: 'Feelings', body: 'Open the app to see what changed.' };

if (pushModule) {
  pushModule.registerPushHandlers?.(self);
} else {
  self.addEventListener('push', (event) => {
    event.waitUntil(
      self.registration.showNotification(FALLBACK_NOTIFICATION.title, {
        body: FALLBACK_NOTIFICATION.body,
        icon: '/icons/icon-192.png',
        badge: '/icons/badge-96.png',
        lang: 'en-IN',
      }),
    );
  });
  self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
      self.clients
        .matchAll({ type: 'window', includeUncontrolled: true })
        .then((windows) => windows[0]?.focus() ?? self.clients.openWindow('/')),
    );
  });
}
