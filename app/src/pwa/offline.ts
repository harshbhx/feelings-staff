/**
 * Online/offline and cached-data state for the offline banner (PRD 11.4). Owner: WP-7.
 * `cachedAt` comes from the latest `fs:cached` message of the service worker (an API read answered
 * from `api-v1`) and is cleared on the `online` event. The banner copy lives in the staff shell.
 */
import { useSyncExternalStore } from 'react';
import { isCachedMessage } from './protocol';

export interface OfflineState {
  online: boolean;
  /** Epoch ms of the cached copy the app is showing, or null when everything is fresh. */
  cachedAt: number | null;
}

function readOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

const listeners = new Set<() => void>();
let state: OfflineState = { online: readOnline(), cachedAt: null };
let watching = false;

function set(next: OfflineState): void {
  if (next.online === state.online && next.cachedAt === state.cachedAt) return;
  state = next;
  for (const l of listeners) l();
}

/** Start listening (idempotent). startPwa() calls it early so no SW message is missed. */
export function startOfflineWatch(): void {
  if (watching || typeof window === 'undefined') return;
  watching = true;
  window.addEventListener('online', () => set({ online: true, cachedAt: null }));
  window.addEventListener('offline', () => set({ ...state, online: false }));
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
      const data: unknown = event.data;
      if (isCachedMessage(data)) set({ ...state, cachedAt: data.cachedAt });
    });
  }
  set({ ...state, online: readOnline() });
}

export function getOfflineState(): OfflineState {
  return state;
}

function subscribeOffline(listener: () => void): () => void {
  startOfflineWatch();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useOfflineState(): OfflineState {
  return useSyncExternalStore(subscribeOffline, getOfflineState, getOfflineState);
}
