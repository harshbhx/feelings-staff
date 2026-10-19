/**
 * Test flags the auth screens honour (PRD 4.2, 14.4). `?allowBrowser=1` lets a browser tab act as
 * the installed app, but only on localhost and Worker Preview hosts, never in production. The flag
 * is remembered for the tab (sessionStorage `fs.allowBrowser`) and carried on internal navigations,
 * so the staff install gate (WP-7) lets E2E runs through after sign-in.
 */
const ALLOW_KEY = 'fs.allowBrowser';
const DEV_HOST = /^(?:localhost|127\.0\.0\.1)$|\.workers\.dev$/;

export function isDevHost(hostname: string): boolean {
  return DEV_HOST.test(hostname);
}

/** Pure form of {@link allowBrowser}: the URL flag or the remembered one, on a dev host only. */
export function allowBrowserFrom(search: string, hostname: string, remembered: boolean): boolean {
  if (!isDevHost(hostname)) return false;
  return new URLSearchParams(search).get('allowBrowser') === '1' || remembered;
}

function remembered(): boolean {
  try {
    return sessionStorage.getItem(ALLOW_KEY) === '1';
  } catch {
    return false;
  }
}

/** True when this tab may act as the installed app (E2E on localhost and previews only). */
export function allowBrowser(): boolean {
  if (typeof window === 'undefined') return false;
  const saved = remembered();
  const on = allowBrowserFrom(window.location.search, window.location.hostname, saved);
  if (on && !saved) {
    try {
      sessionStorage.setItem(ALLOW_KEY, '1');
    } catch {
      // storage blocked: the URL flag still works for this page
    }
  }
  return on;
}

/** Add `allowBrowser=1` to an app path when `on`. Keeps the existing query and hash. */
export function withAllowBrowser(path: string, on: boolean): string {
  if (!on) return path;
  const url = new URL(path, 'https://app.invalid');
  url.searchParams.set('allowBrowser', '1');
  return `${url.pathname}${url.search}${url.hash}`;
}

/** An internal path with the test flag carried over when this tab has it. */
export function withFlags(path: string): string {
  return withAllowBrowser(path, allowBrowser());
}

/** Running as the installed Home Screen app (`display-mode: standalone` or iOS `navigator.standalone`). */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  try {
    return (
      window.matchMedia?.('(display-mode: standalone)').matches === true || nav.standalone === true
    );
  } catch {
    return nav.standalone === true;
  }
}

/** Installed, or a test tab allowed to act like it. */
export function actsInstalled(): boolean {
  return isStandalone() || allowBrowser();
}
