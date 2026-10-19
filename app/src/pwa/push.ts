/**
 * Client side of Web Push (PRD 11.6, 11.8). Owner: WP-8.
 * Permission is requested only from enable(), which must be wired to a tap.
 */
import type { ApiClient } from '@fs/contracts';
import { useCallback, useEffect, useState } from 'react';
import { useApi } from '../api/provider';

export type Platform = 'android' | 'ios' | 'desktop' | 'other';

export type PushState =
  | 'unsupported'
  | 'needs-install'
  | 'default'
  | 'denied'
  | 'granted-subscribed'
  | 'granted-unsubscribed';

export function platformFromUserAgent(ua: string, maxTouchPoints = 0): Platform {
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  // iPadOS 13+ reports as a Mac but has a touch screen.
  if (/macintosh/i.test(ua) && maxTouchPoints > 1) return 'ios';
  if (/windows|macintosh|linux|cros/i.test(ua)) return 'desktop';
  return 'other';
}

/** Base64url (VAPID public key) to bytes for pushManager.subscribe. */
export function base64UrlToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padded = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function bufferToBase64Url(buf: ArrayBuffer | null): string {
  if (!buf) return '';
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface PushEnv {
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  permission: NotificationPermission;
  platform: Platform;
  standalone: boolean;
  subscribed: boolean;
}

export function derivePushState(env: PushEnv): PushState {
  if (env.platform === 'ios' && !env.standalone) return 'needs-install';
  if (!env.hasServiceWorker || !env.hasPushManager || !env.hasNotification) return 'unsupported';
  if (env.permission === 'denied') return 'denied';
  if (env.permission === 'default') return 'default';
  return env.subscribed ? 'granted-subscribed' : 'granted-unsubscribed';
}

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function pushPermission(): NotificationPermission {
  return typeof Notification === 'undefined' ? 'denied' : Notification.permission;
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true || nav.standalone === true
  );
}

export function currentPlatform(): Platform {
  return platformFromUserAgent(navigator.userAgent, navigator.maxTouchPoints);
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

/** Request permission and subscribe. Call only from a user tap. Resolves to the final state. */
export async function enablePush(api: ApiClient): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'default';
  const [{ vapidPublicKey }, reg] = await Promise.all([
    api.config(),
    navigator.serviceWorker.ready,
  ]);
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(vapidPublicKey),
    }));
  const json = sub.toJSON();
  await api.pushSubscribe({
    body: {
      endpoint: sub.endpoint,
      expirationTime: sub.expirationTime,
      keys: {
        p256dh: json.keys?.p256dh ?? bufferToBase64Url(sub.getKey('p256dh')),
        auth: json.keys?.auth ?? bufferToBase64Url(sub.getKey('auth')),
      },
      platform: currentPlatform(),
    },
  });
  return 'granted-subscribed';
}

export async function disablePush(api: ApiClient): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  await api.pushUnsubscribe({ body: { endpoint } });
}

export function usePush() {
  const api = useApi();
  const [state, setState] = useState<PushState>('unsupported');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const subscribed = (await currentSubscription()) !== null;
    setState(
      derivePushState({
        hasServiceWorker: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
        hasPushManager: typeof window !== 'undefined' && 'PushManager' in window,
        hasNotification: typeof Notification !== 'undefined',
        permission: pushPermission(),
        platform: typeof navigator === 'undefined' ? 'other' : currentPlatform(),
        standalone: isStandalone(),
        subscribed,
      }),
    );
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const enable = useCallback(async () => {
    setBusy(true);
    try {
      await enablePush(api);
    } finally {
      setBusy(false);
      await refresh();
    }
  }, [api, refresh]);

  const disable = useCallback(async () => {
    setBusy(true);
    try {
      await disablePush(api);
    } finally {
      setBusy(false);
      await refresh();
    }
  }, [api, refresh]);

  return { state, busy, enable, disable };
}
