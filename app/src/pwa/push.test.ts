import { describe, expect, it } from 'vitest';
import {
  base64UrlToUint8Array,
  bufferToBase64Url,
  derivePushState,
  type PushEnv,
  platformFromUserAgent,
} from './push';

const base: PushEnv = {
  hasServiceWorker: true,
  hasPushManager: true,
  hasNotification: true,
  permission: 'default',
  platform: 'android',
  standalone: false,
  subscribed: false,
};

describe('S-15.2 push helpers', () => {
  it('detects the platform from the user agent', () => {
    expect(platformFromUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8)')).toBe('android');
    expect(platformFromUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe(
      'ios',
    );
    expect(platformFromUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', 5)).toBe('ios');
    expect(platformFromUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', 0)).toBe(
      'desktop',
    );
    expect(platformFromUserAgent('Mozilla/5.0 (Windows NT 10.0)')).toBe('desktop');
    expect(platformFromUserAgent('curl/8')).toBe('other');
  });

  it('converts base64url to bytes and back', () => {
    const bytes = base64UrlToUint8Array('SGVsbG8_-w');
    expect(Array.from(bytes)).toEqual([72, 101, 108, 108, 111, 63, 251]);
    expect(bufferToBase64Url(bytes.buffer)).toBe('SGVsbG8_-w');
  });

  it('derives the state', () => {
    expect(derivePushState({ ...base, hasPushManager: false })).toBe('unsupported');
    expect(derivePushState({ ...base, platform: 'ios', standalone: false })).toBe('needs-install');
    expect(derivePushState({ ...base, platform: 'ios', standalone: true })).toBe('default');
    expect(derivePushState(base)).toBe('default');
    expect(derivePushState({ ...base, permission: 'denied' })).toBe('denied');
    expect(derivePushState({ ...base, permission: 'granted' })).toBe('granted-unsubscribed');
    expect(derivePushState({ ...base, permission: 'granted', subscribed: true })).toBe(
      'granted-subscribed',
    );
  });
});
