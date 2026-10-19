import { fromBase64Url } from '@fs/contracts';
import { describe, expect, it } from 'vitest';
import {
  androidModel,
  browserName,
  detectPlatform,
  deviceLabelFromUa,
  signWithKey,
} from './device-key';

const UA = {
  redmiChrome:
    'Mozilla/5.0 (Linux; Android 13; Redmi Note 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  reducedChrome:
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  samsung:
    'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  webview:
    'Mozilla/5.0 (Linux; Android 13; 23021RAAEG Build/TKQ1.221114.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 WhatsApp/2.24',
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1',
  ipadDesktop:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  windowsEdge:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
};

describe('device label and platform (PRD 4.1.4)', () => {
  it('reads the Android model and browser', () => {
    expect(deviceLabelFromUa(UA.redmiChrome)).toBe('Redmi Note 12 · Chrome');
    expect(deviceLabelFromUa(UA.samsung)).toBe('SM-A546E · Samsung Internet');
    expect(androidModel(UA.webview)).toBe('23021RAAEG');
  });

  it('uses the Client Hints model when the UA is reduced', () => {
    expect(androidModel(UA.reducedChrome)).toBeNull();
    expect(deviceLabelFromUa(UA.reducedChrome)).toBe('Android phone · Chrome');
    expect(deviceLabelFromUa(UA.reducedChrome, { model: 'Redmi Note 12' })).toBe(
      'Redmi Note 12 · Chrome',
    );
  });

  it('labels iPhones, iPads in desktop mode and computers', () => {
    expect(deviceLabelFromUa(UA.iphoneSafari)).toBe('iPhone · Safari');
    expect(deviceLabelFromUa(UA.iphoneChrome)).toBe('iPhone · Chrome');
    expect(deviceLabelFromUa(UA.ipadDesktop, { maxTouchPoints: 5 })).toBe('iPad · Safari');
    expect(deviceLabelFromUa(UA.windowsEdge)).toBe('Windows · Edge');
  });

  it('detects the platform', () => {
    expect(detectPlatform(UA.redmiChrome)).toBe('android');
    expect(detectPlatform(UA.iphoneSafari)).toBe('ios');
    expect(detectPlatform(UA.ipadDesktop, 5)).toBe('ios');
    expect(detectPlatform(UA.ipadDesktop, 0)).toBe('desktop');
    expect(detectPlatform(UA.windowsEdge)).toBe('desktop');
    expect(detectPlatform('curl/8.0')).toBe('other');
  });

  it('names in-app browsers', () => {
    expect(browserName(UA.webview)).toBe('WhatsApp');
    expect(browserName('Mozilla/5.0 (iPhone) Instagram 300.0')).toBe('Instagram');
  });
});

describe('device signatures (PRD 10.3)', () => {
  it('signs with a non-extractable key and the signature verifies (P1363, base64url)', async () => {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, [
      'sign',
      'verify',
    ])) as CryptoKeyPair;
    expect(pair.privateKey.extractable).toBe(false);
    const sig = await signWithKey(pair.privateKey, 'nonce-123');
    expect(sig).toMatch(/^[A-Za-z0-9_-]+$/);
    const bytes = fromBase64Url(sig);
    expect(bytes.length).toBe(64);
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      pair.publicKey,
      bytes,
      new TextEncoder().encode('nonce-123'),
    );
    expect(ok).toBe(true);
  });
});
