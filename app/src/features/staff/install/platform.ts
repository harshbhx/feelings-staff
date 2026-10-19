/**
 * Where the staff app is running, for the install gate (PRD 4.2, 11.8; AC S-03).
 *
 * - `standalone`: the installed app (display-mode standalone/fullscreen, or iOS `navigator.standalone`).
 * - `ios-safari`: iPhone/iPad Safari, which installs through Share -> Add to Home Screen.
 * - `ios-other`: any other iOS browser or in-app browser (Chrome, Firefox, WhatsApp, Instagram):
 *   only Safari can install, so we ask the person to open the link in Safari.
 * - `android`: Android Chromium-family browser; installs through `beforeinstallprompt` or the menu.
 * - `android-inapp`: an Android in-app browser (WhatsApp, Instagram, Facebook): open in Chrome.
 * - `desktop`: not a phone; staff pages say "Open this link on your phone" with a QR.
 */
export type InstallContext =
  | 'standalone'
  | 'ios-safari'
  | 'ios-other'
  | 'android'
  | 'android-inapp'
  | 'desktop';

export interface PlatformProbe {
  userAgent: string;
  /** `navigator.platform` (iPadOS reports `MacIntel`). */
  platform?: string | undefined;
  maxTouchPoints?: number | undefined;
  /** `matchMedia('(display-mode: standalone)')` or fullscreen/minimal-ui. */
  displayModeStandalone: boolean;
  /** iOS `navigator.standalone`. */
  navigatorStandalone?: boolean | undefined;
}

const IOS_OTHER_BROWSERS =
  /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|GSA\/|YaBrowser|DuckDuckGo|Brave|FBAN|FBAV|Instagram|WhatsApp|Line\/|Snapchat|Twitter/i;
const ANDROID_IN_APP = /\bwv\b|FBAN|FBAV|Instagram|WhatsApp|Line\/|Snapchat|Twitter/i;

export function isIos(p: Pick<PlatformProbe, 'userAgent' | 'platform' | 'maxTouchPoints'>) {
  if (/iPhone|iPad|iPod/i.test(p.userAgent)) return true;
  // iPadOS 13+ asks for the desktop site and reports a Mac; a touch screen gives it away.
  return p.platform === 'MacIntel' && (p.maxTouchPoints ?? 0) > 1;
}

export function detectInstallContext(p: PlatformProbe): InstallContext {
  if (p.displayModeStandalone || p.navigatorStandalone === true) return 'standalone';
  const ua = p.userAgent;
  if (isIos(p)) {
    // Real Safari has "Safari/" and "Version/"; WKWebView-based in-app browsers usually lack them.
    const safari = /Safari\//.test(ua) && /Version\//.test(ua) && !IOS_OTHER_BROWSERS.test(ua);
    return safari ? 'ios-safari' : 'ios-other';
  }
  if (/Android/i.test(ua)) return ANDROID_IN_APP.test(ua) ? 'android-inapp' : 'android';
  return 'desktop';
}

/** Probe the real browser. Safe to call during render. */
export function probeBrowser(): PlatformProbe {
  if (typeof window === 'undefined') {
    return { userAgent: '', displayModeStandalone: false };
  }
  const mm = (q: string) =>
    typeof window.matchMedia === 'function' ? window.matchMedia(q).matches : false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return {
    userAgent: nav.userAgent,
    platform: nav.platform,
    maxTouchPoints: nav.maxTouchPoints,
    displayModeStandalone:
      mm('(display-mode: standalone)') ||
      mm('(display-mode: fullscreen)') ||
      mm('(display-mode: minimal-ui)'),
    navigatorStandalone: nav.standalone,
  };
}

export function currentInstallContext(): InstallContext {
  return detectInstallContext(probeBrowser());
}
