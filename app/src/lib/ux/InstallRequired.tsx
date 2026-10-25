/**
 * The install requirement. Feelings is an app: on a phone or tablet in a browser tab, the whole app
 * is replaced by a full-screen install gate that cannot be dismissed and comes back on every load
 * until the page runs standalone (the Home Screen app). On a computer nothing is blocked; a slim
 * hint says the app is for phones. Left alone: the installed app, the staff sign-in and invite
 * pages (they teach the install themselves and carry the join code), the door display, the public
 * verify page, the kit, automated browsers (`?installGate=1` turns the gate on for them) and
 * `?allowBrowser=1` on a non-production host.
 *
 * This file is in the first chunk, so it stays small: the screens are lazy.
 */
import { lazy, Suspense, useSyncExternalStore } from 'react';
import { Outlet, useLocation } from 'react-router';
import { browserAllowed } from '../../features/staff/install/allow-browser';
// Catches `beforeinstallprompt` from the first moment, before the lazy gate chunk arrives.
import '../../features/staff/install/prompt';

const Gate = lazy(() => import('./InstallGate').then((m) => ({ default: m.InstallGate })));
const Hint = lazy(() => import('./InstallHint').then((m) => ({ default: m.InstallHint })));

const EXEMPT = ['/join', '/signin', '/waiting', '/door', '/v/', '/__kit'] as const;
const FORCE_KEY = 'fs.installGate';
const MODES = ['standalone', 'fullscreen', 'minimal-ui'] as const;

export function isRunningStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return (
    nav.standalone === true ||
    MODES.some((m) => window.matchMedia?.(`(display-mode: ${m})`).matches === true)
  );
}

/** Re-checked when the display mode changes, the app is installed, or the tab comes back. */
function subscribe(cb: () => void): () => void {
  const lists = MODES.map((m) => window.matchMedia?.(`(display-mode: ${m})`));
  for (const l of lists) l?.addEventListener?.('change', cb);
  window.addEventListener('appinstalled', cb);
  document.addEventListener('visibilitychange', cb);
  return () => {
    for (const l of lists) l?.removeEventListener?.('change', cb);
    window.removeEventListener('appinstalled', cb);
    document.removeEventListener('visibilitychange', cb);
  };
}

function forced(): boolean {
  try {
    if (new URLSearchParams(window.location.search).get('installGate') === '1')
      sessionStorage.setItem(FORCE_KEY, '1');
    return sessionStorage.getItem(FORCE_KEY) === '1';
  } catch {
    return false;
  }
}

function touchDevice(): boolean {
  const nav = navigator;
  return (
    /iPhone|iPad|iPod|Android/i.test(nav.userAgent) ||
    // iPadOS asks for the desktop site and reports a Mac; a touch screen gives it away.
    (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1)
  );
}

/** What the page in front of the person must do about installing. */
export function installMode(pathname: string, standalone: boolean): 'none' | 'gate' | 'hint' {
  if (standalone || EXEMPT.some((p) => pathname.startsWith(p))) return 'none';
  if (browserAllowed()) return 'none';
  if (navigator.webdriver === true && !forced()) return 'none';
  return touchDevice() ? 'gate' : 'hint';
}

export function InstallRequired() {
  const { pathname } = useLocation();
  const standalone = useSyncExternalStore(subscribe, isRunningStandalone, () => true);
  const mode = installMode(pathname, standalone);
  if (mode === 'gate')
    return (
      <Suspense fallback={null}>
        <Gate />
      </Suspense>
    );
  return (
    <>
      {mode === 'hint' ? (
        <Suspense fallback={null}>
          <Hint />
        </Suspense>
      ) : null}
      <Outlet />
    </>
  );
}
