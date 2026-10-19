/// <reference lib="webworker" />
/**
 * Push handling inside the service worker (PRD 11.6, 11.8). Owner: WP-8.
 * Dependency-free so sw.ts can import it: `registerPushHandlers(self)`.
 * Every push path calls showNotification inside waitUntil, including parse errors and missing
 * data, so Safari never counts a silent push.
 */
import type { PushPayload } from '@fs/contracts';

export const FALLBACK_TITLE = 'Feelings';
export const FALLBACK_BODY = 'Open the app to see what changed.';
export const NOTIFICATION_ICON = '/icons/icon-192.png';
export const NOTIFICATION_BADGE = '/icons/badge-96.png';

/**
 * Sent as X-FS-Client from the worker. The page sends the real app version; the worker only
 * needs to pass the CSRF gate and the minimum-version check, so it claims a very high one.
 */
export const SW_CLIENT_VERSION = '999.0.0';

export interface PushHandlerOptions {
  clientVersion?: string;
  apiBase?: string;
}

type PartialPayload = Partial<Omit<PushPayload, 'notification'>> & {
  notification?: Partial<PushPayload['notification']>;
};

export interface ShownNotification {
  title: string;
  options: NotificationOptions & { renotify?: boolean };
  badge: number | undefined;
  type: string | undefined;
}

/** Read the payload, never throwing: a bad or missing body gives an empty object. */
export function readPayload(data: PushMessageData | null | undefined): PartialPayload {
  if (!data) return {};
  try {
    const parsed: unknown = data.json();
    return parsed && typeof parsed === 'object' ? (parsed as PartialPayload) : {};
  } catch {
    return {};
  }
}

export function buildNotification(data: PartialPayload): ShownNotification {
  const n = data.notification;
  const title = typeof n?.title === 'string' && n.title ? n.title : FALLBACK_TITLE;
  const body = typeof n?.title === 'string' && n.title ? n.body : FALLBACK_BODY;
  const url = typeof n?.navigate === 'string' && n.navigate.startsWith('/') ? n.navigate : '/';
  return {
    title,
    options: {
      body,
      icon: NOTIFICATION_ICON,
      badge: NOTIFICATION_BADGE,
      ...(data.topic ? { tag: data.topic } : {}),
      renotify: data.t !== 'summary',
      lang: n?.lang ?? 'en-IN',
      data: { url, e: data.e },
    },
    badge: typeof data.badge === 'number' ? data.badge : undefined,
    type: data.t,
  };
}

type BadgeNavigator = {
  setAppBadge?: (n?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

async function setBadge(sw: ServiceWorkerGlobalScope, count: number | undefined) {
  const nav = sw.navigator as unknown as BadgeNavigator;
  try {
    if (count === 0) await nav.clearAppBadge?.();
    else await nav.setAppBadge?.(count);
  } catch {
    // badge is a nicety
  }
}

export async function notifyClients(sw: ServiceWorkerGlobalScope, t: string | undefined) {
  try {
    const all = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) c.postMessage({ type: 'push', t });
  } catch {
    // open tabs refetch on focus anyway
  }
}

export function handlePush(sw: ServiceWorkerGlobalScope, event: PushEvent): void {
  let shown: ShownNotification;
  try {
    shown = buildNotification(readPayload(event.data));
  } catch {
    shown = buildNotification({});
  }
  event.waitUntil(
    Promise.all([
      sw.registration.showNotification(shown.title, shown.options),
      setBadge(sw, shown.badge),
      notifyClients(sw, shown.type),
    ]),
  );
}

async function reportOpened(e: unknown, opts: PushHandlerOptions) {
  if (typeof e !== 'string' || !e) return;
  try {
    await fetch(`${opts.apiBase ?? '/api/v1'}/notifications/${encodeURIComponent(e)}/opened`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-FS-Client': opts.clientVersion ?? SW_CLIENT_VERSION },
    });
  } catch {
    // escalation is best effort
  }
}

async function focusOrOpen(sw: ServiceWorkerGlobalScope, path: string) {
  const target = new URL(path, sw.location.origin).href;
  const all = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const existing = all[0] as WindowClient | undefined;
  if (existing) {
    try {
      const focused = (await existing.focus()) as WindowClient | undefined;
      await (focused ?? existing).navigate(target);
      return;
    } catch {
      // navigate can be refused (uncontrolled client); open a new window instead
    }
  }
  await sw.clients.openWindow(target);
}

export function handleNotificationClick(
  sw: ServiceWorkerGlobalScope,
  event: NotificationEvent,
  opts: PushHandlerOptions = {},
): void {
  event.notification.close();
  const data = (event.notification.data ?? {}) as { url?: unknown; e?: unknown };
  const url = typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/';
  event.waitUntil(Promise.all([focusOrOpen(sw, url), reportOpened(data.e, opts)]));
}

export function platformFromUserAgent(ua: string): 'android' | 'ios' | 'desktop' | 'other' {
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  if (/windows|macintosh|linux|cros/i.test(ua)) return 'desktop';
  return 'other';
}

function toBase64Url(buf: ArrayBuffer | null): string {
  if (!buf) return '';
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function resubscribe(
  sw: ServiceWorkerGlobalScope,
  event: Event & { oldSubscription?: PushSubscription | null },
  opts: PushHandlerOptions = {},
) {
  const key = event.oldSubscription?.options?.applicationServerKey;
  if (!key) return;
  const sub = await sw.registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: key,
  });
  const json = sub.toJSON();
  const p256dh = json.keys?.p256dh ?? toBase64Url(sub.getKey('p256dh'));
  const auth = json.keys?.auth ?? toBase64Url(sub.getKey('auth'));
  await fetch(`${opts.apiBase ?? '/api/v1'}/push/subscribe`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-FS-Client': opts.clientVersion ?? SW_CLIENT_VERSION,
    },
    body: JSON.stringify({
      endpoint: sub.endpoint,
      expirationTime: sub.expirationTime,
      keys: { p256dh, auth },
      platform: platformFromUserAgent(sw.navigator.userAgent),
    }),
  });
}

export function registerPushHandlers(sw: ServiceWorkerGlobalScope, opts: PushHandlerOptions = {}) {
  sw.addEventListener('push', (event) => handlePush(sw, event));
  sw.addEventListener('notificationclick', (event) => handleNotificationClick(sw, event, opts));
  sw.addEventListener('pushsubscriptionchange', (event) => {
    (event as ExtendableEvent).waitUntil(
      resubscribe(sw, event as Event & { oldSubscription?: PushSubscription | null }, opts).catch(
        () => undefined,
      ),
    );
  });
}
