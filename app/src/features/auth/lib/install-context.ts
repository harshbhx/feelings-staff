/**
 * Which install help a browser tab needs (PRD 4.1.3, 4.2, S-03). Pure, so it is unit-tested with
 * real user agents.
 *
 * | Context          | When                                                        | We show                         |
 * |------------------|-------------------------------------------------------------|---------------------------------|
 * | `installed`      | display-mode standalone, navigator.standalone, test flag    | nothing: go to the app screen   |
 * | `android-prompt` | Android browser and `beforeinstallprompt` was captured      | one **Install the app** button  |
 * | `android-manual` | Android browser without a prompt (yet, or after dismissing) | browser-menu steps              |
 * | `android-in-app` | Android in-app browser (WhatsApp, Instagram, Facebook, wv)  | "Open this link in Chrome"      |
 * | `ios-safari`     | iPhone or iPad Safari                                       | Share, Add to Home Screen, open |
 * | `ios-other`      | iOS Chrome, Firefox, Edge, Google app, in-app browsers      | "Open this link in Safari"      |
 * | `desktop`        | computers and anything we can't place                       | "Open this link on your phone"  |
 */
import { detectPlatform } from '../../../lib/device-key';

export type InstallContext =
  | 'installed'
  | 'android-prompt'
  | 'android-manual'
  | 'android-in-app'
  | 'ios-safari'
  | 'ios-other'
  | 'desktop';

export interface InstallEnv {
  ua: string;
  maxTouchPoints: number;
  /** display-mode standalone or navigator.standalone. */
  standalone: boolean;
  /** `?allowBrowser=1` on a non-production host (tests). */
  allowBrowser: boolean;
  /** A `beforeinstallprompt` event is held and not used yet. */
  canPrompt: boolean;
}

export type InAppBrowser = 'whatsapp' | 'instagram' | 'facebook' | 'webview';

/** In-app browsers can't install a web app; they need the platform browser. */
export function inAppBrowser(ua: string): InAppBrowser | null {
  if (/WhatsApp/i.test(ua)) return 'whatsapp';
  if (/Instagram/i.test(ua)) return 'instagram';
  if (/FBAN|FBAV|FB_IAB|FBIOS/i.test(ua)) return 'facebook';
  if (/Android/i.test(ua) && /;\s*wv\)/.test(ua)) return 'webview';
  return null;
}

/** Safari itself (Add to Home Screen lives in its Share sheet), not another iOS browser. */
export function isIosSafari(ua: string): boolean {
  if (/CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|GSA\/|YaBrowser|DuckDuckGo|Brave|Snapchat|Line\//i.test(ua))
    return false;
  return /Version\/[\d.]+.*Safari\//.test(ua);
}

export function installContext(env: InstallEnv): InstallContext {
  if (env.standalone || env.allowBrowser) return 'installed';
  const platform = detectPlatform(env.ua, env.maxTouchPoints);
  const inApp = inAppBrowser(env.ua) !== null;
  if (platform === 'ios') return !inApp && isIosSafari(env.ua) ? 'ios-safari' : 'ios-other';
  if (platform === 'android') {
    if (inApp) return 'android-in-app';
    return env.canPrompt ? 'android-prompt' : 'android-manual';
  }
  return 'desktop';
}
