import { describe, expect, it } from 'vitest';
import { doorUrl, normaliseDoorToken, parseDoorUrl } from './parse';

const HOST = 'staff.feelingsbeautycare.in';
const SITE = '01K8WN0TQC11QKMBNWMGPP50NM';

describe('parseDoorUrl (PRD 4.5 scanning)', () => {
  it('reads the site id and token from our door URL', () => {
    expect(parseDoorUrl(`https://${HOST}/q/${SITE}/ABCDEFGHJK`, HOST)).toEqual({
      ok: true,
      siteId: SITE,
      token: 'ABCDEFGHJK',
    });
  });

  it('normalises the token: upper case, I and L read as 1, O as 0', () => {
    const r = parseDoorUrl(`https://${HOST}/q/${SITE}/abcdefghio`, HOST);
    expect(r).toEqual({ ok: true, siteId: SITE, token: 'ABCDEFGH10' });
    const l = parseDoorUrl(`https://${HOST}/q/${SITE}/L000000000`, HOST);
    expect(l.ok && l.token).toBe('1000000000');
  });

  it('accepts surrounding whitespace and a trailing slash', () => {
    expect(parseDoorUrl(`  https://${HOST}/q/${SITE}/ABCDEFGHJK/ \n`, HOST).ok).toBe(true);
  });

  it('any other QR is not ours ("That\'s not the door code.")', () => {
    for (const text of [
      'upi://pay?pa=salon@upi',
      'hello',
      '',
      `https://example.com/q/${SITE}/ABCDEFGHJK`,
      `https://${HOST}.evil.test/q/${SITE}/ABCDEFGHJK`,
      `http://${HOST}/q/${SITE}/ABCDEFGHJK`,
      `https://${HOST}/join/K7M4QPXD`,
      `https://user:pw@${HOST}/q/${SITE}/ABCDEFGHJK`,
    ]) {
      expect(parseDoorUrl(text, HOST), text).toEqual({ ok: false, error: 'not_ours' });
    }
  });

  it('our door URL with a malformed site or token is a bad token', () => {
    for (const path of [
      `/q/${SITE}/ABCDEFGHJ`,
      `/q/${SITE}/ABCDEFGHJKM`,
      `/q/${SITE}/ABCDEFGHJU`,
      `/q/${SITE}`,
      `/q/not-a-ulid/ABCDEFGHJK`,
      `/q/${SITE}/ABCDEFGHJK/extra`,
      `/q/${SITE}/%E0%A4%A`,
    ]) {
      expect(parseDoorUrl(`https://${HOST}${path}`, HOST), path).toEqual({
        ok: false,
        error: 'bad_token',
      });
    }
  });

  it('allows plain http only on localhost (E2E)', () => {
    expect(parseDoorUrl(`http://localhost:8787/q/${SITE}/ABCDEFGHJK`, 'localhost:8787').ok).toBe(
      true,
    );
    expect(parseDoorUrl(`http://localhost/q/${SITE}/ABCDEFGHJK`, 'localhost:8787').ok).toBe(false);
  });

  it('defaults to the page host', () => {
    expect(parseDoorUrl(`${location.origin}/q/${SITE}/ABCDEFGHJK`).ok).toBe(
      location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname),
    );
  });
});

describe('normaliseDoorToken (typed "Type the code" fallback)', () => {
  it('takes 10 Crockford characters, ignoring spaces and dashes', () => {
    expect(normaliseDoorToken('abcde-fghjk')).toBe('ABCDEFGHJK');
    expect(normaliseDoorToken(' o1il0 OILO2 ')).toBe('0111001102');
  });

  it('rejects anything else', () => {
    expect(normaliseDoorToken('ABCDEFGHJ')).toBeNull();
    expect(normaliseDoorToken('ABCDEFGHJU')).toBeNull();
    expect(normaliseDoorToken('ABCDEFGHJ!')).toBeNull();
  });
});

describe('doorUrl', () => {
  it('builds the URL the door screen shows', () => {
    expect(doorUrl(`https://${HOST}/`, SITE, 'ABCDEFGHJK')).toBe(
      `https://${HOST}/q/${SITE}/ABCDEFGHJK`,
    );
  });

  it('round-trips through parseDoorUrl', () => {
    expect(parseDoorUrl(doorUrl(`https://${HOST}`, SITE, 'Z9Y8X7W6V5'), HOST)).toEqual({
      ok: true,
      siteId: SITE,
      token: 'Z9Y8X7W6V5',
    });
  });
});
