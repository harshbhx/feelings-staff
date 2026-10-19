/**
 * Shell behaviours: refetch when a push arrives (PRD 11.6: the service worker posts
 * `{ type: 'push' }` to open tabs), the Needs-action count on the app icon (`setAppBadge`), and the
 * online state for the offline banner.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';
import { ownerKeys } from '../api/keys';

/** O-03.2: the board refreshes immediately when a push lands. */
export function usePushRefetch(): void {
  const qc = useQueryClient();
  useEffect(() => {
    const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined;
    if (!sw) return;
    const onMessage = (e: MessageEvent) => {
      const data: unknown = e.data;
      if (data && typeof data === 'object' && (data as { type?: unknown }).type === 'push') {
        void qc.invalidateQueries({ queryKey: ownerKeys.today() });
        void qc.invalidateQueries({ queryKey: ownerKeys.actionsAll() });
      }
    };
    sw.addEventListener('message', onMessage);
    return () => sw.removeEventListener('message', onMessage);
  }, [qc]);
}

type BadgeNavigator = Navigator & {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

/** O-04.4: the app icon shows the number of open Needs-action items. */
export function useAppBadge(count: number | null): void {
  useEffect(() => {
    if (count === null || typeof navigator === 'undefined') return;
    const nav = navigator as BadgeNavigator;
    const done = count > 0 ? nav.setAppBadge?.(count) : nav.clearAppBadge?.();
    done?.catch(() => {
      // Badging is optional (not every browser allows it); the tab badge still shows the count.
    });
  }, [count]);
}

function subscribeOnline(cb: () => void) {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

/** iOS Safari in a browser tab (not installed): push needs the Home Screen app (PRD 11.8). */
export function isIosBrowserTab(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}

const IOS_BANNER_KEY = 'fs.owner.iosBanner';

export function iosBannerSeen(): boolean {
  try {
    return localStorage.getItem(IOS_BANNER_KEY) === '1';
  } catch {
    return false;
  }
}

export function markIosBannerSeen(): void {
  try {
    localStorage.setItem(IOS_BANNER_KEY, '1');
  } catch {
    // storage unavailable: the banner may show again next time, which is harmless
  }
}
