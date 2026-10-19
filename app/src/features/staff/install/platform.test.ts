import { describe, expect, it } from 'vitest';
import { browserAllowed, isNonProductionHost } from './allow-browser';
import { detectInstallContext, type PlatformProbe } from './platform';

const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Redmi Note 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const IOS_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IOS_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1';
const IOS_WHATSAPP =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WhatsApp/24.20.79';
const ANDROID_WEBVIEW =
  'Mozilla/5.0 (Linux; Android 14; RMX3741 Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36 Instagram 350.0';
const DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const IPADOS =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

const probe = (userAgent: string, extra: Partial<PlatformProbe> = {}): PlatformProbe => ({
  userAgent,
  displayModeStandalone: false,
  ...extra,
});

describe('install context (PRD 4.2, AC S-03)', () => {
  it('S-03.4 the installed app is standalone on every platform', () => {
    expect(detectInstallContext(probe(ANDROID_CHROME, { displayModeStandalone: true }))).toBe(
      'standalone',
    );
    expect(detectInstallContext(probe(IOS_SAFARI, { navigatorStandalone: true }))).toBe(
      'standalone',
    );
  });

  it('S-03.2 iOS Safari gets the 3-step sheet; other iOS browsers get "Open in Safari"', () => {
    expect(detectInstallContext(probe(IOS_SAFARI))).toBe('ios-safari');
    expect(detectInstallContext(probe(IOS_CHROME))).toBe('ios-other');
    expect(detectInstallContext(probe(IOS_WHATSAPP))).toBe('ios-other');
    expect(detectInstallContext(probe(IPADOS, { platform: 'MacIntel', maxTouchPoints: 5 }))).toBe(
      'ios-safari',
    );
  });

  it('S-03.1 Android Chrome uses the install prompt; in-app browsers are sent to Chrome', () => {
    expect(detectInstallContext(probe(ANDROID_CHROME))).toBe('android');
    expect(detectInstallContext(probe(ANDROID_WEBVIEW))).toBe('android-inapp');
  });

  it('desktop gets "Open on your phone"', () => {
    expect(detectInstallContext(probe(DESKTOP))).toBe('desktop');
    expect(detectInstallContext(probe(IPADOS, { platform: 'MacIntel', maxTouchPoints: 0 }))).toBe(
      'desktop',
    );
  });
});

describe('?allowBrowser=1 (PRD 4.2 rules)', () => {
  it('S-03.3 works only on non-production hosts', () => {
    expect(isNonProductionHost('localhost')).toBe(true);
    expect(isNonProductionHost('feelings-staff-pr-12.harshbhx.workers.dev')).toBe(true);
    expect(isNonProductionHost('staff.feelingsbeautycare.in')).toBe(false);
    expect(
      browserAllowed({ hostname: 'staff.feelingsbeautycare.in', search: '?allowBrowser=1' }),
    ).toBe(false);
  });

  it('S-03.3 sticks for the tab once set on localhost', () => {
    sessionStorage.clear();
    expect(browserAllowed({ hostname: 'localhost', search: '?allowBrowser=1' })).toBe(true);
    expect(browserAllowed({ hostname: 'localhost', search: '' })).toBe(true);
    expect(browserAllowed({ hostname: 'localhost', search: '?allowBrowser=0' })).toBe(false);
  });
});
