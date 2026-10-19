/// <reference lib="webworker" />
/**
 * Service worker entry (vite-plugin-pwa injectManifest; PRD 11.4). Owner: WP-7.
 * Push and click handlers come from ./sw/push-handlers.ts (owner: WP-8).
 */
declare let self: ServiceWorkerGlobalScope;

self.addEventListener('install', () => {
  void self.skipWaiting();
});

export {};
