import { describe, expect, it } from 'vitest';
import { type InstallEnv, inAppBrowser, installContext, isIosSafari } from './install-context';

const UA = {
  androidChrome:
    'Mozilla/5.0 (Linux; Android 14; Redmi Note 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  samsung:
    'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  androidWhatsApp:
    'Mozilla/5.0 (Linux; Android 13; 23021RAAEG Build/TKQ1.221114.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 WhatsApp/2.24',
  androidInstagram:
    'Mozilla/5.0 (Linux; Android 14; SM-A546E Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.6723.86 Mobile Safari/537.36 Instagram 354.0.0.0.89 Android',
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1',
  iphoneFirefox:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/132.0 Mobile/15E148 Safari/605.1.15',
  iphoneFacebook:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/485.0.0.0;FBBV/653000000;FBDV/iPhone15,3]',
  iphoneInstagram:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 354.0.0.0.89 (iPhone15,3; iOS 18_0; en_IN)',
  ipadDesktop:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  windowsEdge:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
};

const env = (ua: string, over: Partial<InstallEnv> = {}): InstallEnv => ({
  ua,
  maxTouchPoints: 0,
  standalone: false,
  allowBrowser: false,
  canPrompt: false,
  ...over,
});

describe('install context (PRD 4.1.3, 4.2)', () => {
  it('S-03.1 Android shows our Install button only after beforeinstallprompt', () => {
    expect(installContext(env(UA.androidChrome))).toBe('android-manual');
    expect(installContext(env(UA.androidChrome, { canPrompt: true }))).toBe('android-prompt');
    expect(installContext(env(UA.samsung, { canPrompt: true }))).toBe('android-prompt');
  });

  it('S-03.2 iOS Safari gets the 3-step sheet; other iOS browsers get "Open in Safari"', () => {
    expect(installContext(env(UA.iphoneSafari))).toBe('ios-safari');
    expect(installContext(env(UA.ipadDesktop, { maxTouchPoints: 5 }))).toBe('ios-safari');
    expect(installContext(env(UA.iphoneChrome))).toBe('ios-other');
    expect(installContext(env(UA.iphoneFirefox))).toBe('ios-other');
    expect(installContext(env(UA.iphoneFacebook))).toBe('ios-other');
    expect(installContext(env(UA.iphoneInstagram))).toBe('ios-other');
  });

  it('in-app browsers on Android are sent to Chrome, even with a prompt', () => {
    expect(installContext(env(UA.androidWhatsApp, { canPrompt: true }))).toBe('android-in-app');
    expect(installContext(env(UA.androidInstagram))).toBe('android-in-app');
  });

  it('computers get "Open this link on your phone"', () => {
    expect(installContext(env(UA.windowsEdge, { canPrompt: true }))).toBe('desktop');
    expect(installContext(env(UA.macSafari))).toBe('desktop');
  });

  it('S-03.4 the installed app (or the test flag) never shows install help', () => {
    expect(installContext(env(UA.iphoneSafari, { standalone: true }))).toBe('installed');
    expect(installContext(env(UA.androidChrome, { canPrompt: true, standalone: true }))).toBe(
      'installed',
    );
    expect(installContext(env(UA.androidChrome, { allowBrowser: true }))).toBe('installed');
  });

  it('names in-app browsers and tells Safari from look-alikes', () => {
    expect(inAppBrowser(UA.androidWhatsApp)).toBe('whatsapp');
    expect(inAppBrowser(UA.iphoneFacebook)).toBe('facebook');
    expect(inAppBrowser(UA.iphoneInstagram)).toBe('instagram');
    expect(inAppBrowser(UA.androidChrome)).toBeNull();
    expect(isIosSafari(UA.iphoneSafari)).toBe(true);
    expect(isIosSafari(UA.iphoneChrome)).toBe(false);
    expect(isIosSafari(UA.iphoneFacebook)).toBe(false);
  });
});
