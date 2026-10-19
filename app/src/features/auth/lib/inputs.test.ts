import { describe, expect, it } from 'vitest';
import { allowBrowserFrom, withAllowBrowser } from './flags';
import {
  checkNewPin,
  digitsOnly,
  formatCodeInput,
  looksLikeEmail,
  parseJoinCode,
  parsePhone,
  phoneForField,
  pinComplete,
  STAFF_PIN,
} from './inputs';
import { nextFitsRole, safeNext } from './next';
import { qrPath } from './qr';

describe('phone and join code glue (PRD 4.1.1, 4.1.2)', () => {
  it('normalises the ways people type an Indian mobile', () => {
    expect(parsePhone('98250 11201')).toBe('+919825011201');
    expect(parsePhone('+91 98250-11201')).toBe('+919825011201');
    expect(parsePhone('098250 11201')).toBe('+919825011201');
    expect(parsePhone('12345')).toBeNull();
    expect(parsePhone('5825011201')).toBeNull();
    expect(phoneForField('+919825011201')).toBe('98250 11201');
    expect(phoneForField(null)).toBe('');
  });

  it('formats the code as XXX-XXXXX while typing and parses it like the server', () => {
    expect(formatCodeInput('k7m')).toBe('K7M');
    expect(formatCodeInput('k7m4')).toBe('K7M-4');
    expect(formatCodeInput('k7m4qpxd')).toBe('K7M-4QPXD');
    expect(formatCodeInput('K7M-4QPXD-EXTRA')).toBe('K7M-4QPXD');
    expect(formatCodeInput(' k7m 4qp xd ')).toBe('K7M-4QPXD');
    expect(parseJoinCode('K7M-4QPXD')).toBe('K7M4QPXD');
    expect(parseJoinCode('k7m4qpxo')).toBe('K7M4QPX0');
    expect(parseJoinCode('K7M-4QP')).toBeNull();
    expect(parseJoinCode('K7M-4QPXU')).toBeNull();
  });
});

describe('PIN pad validation (PRD 4.1.4, S-01.2)', () => {
  it('S-01.2 rejects 1111, 1234, 4321, 0000 and the end of the phone number', () => {
    const phone = '+919825011201';
    for (const pin of ['1111', '1234', '4321', '0000', '123456', '1201', '011201']) {
      expect(checkNewPin(pin, phone).ok, pin).toBe(false);
    }
    expect(checkNewPin('2580', phone)).toEqual({ ok: true });
    expect(checkNewPin('482913', phone)).toEqual({ ok: true });
  });

  it('asks for at least 4 digits before the strength rules', () => {
    expect(checkNewPin('25', null)).toEqual({ ok: false, reason: 'short' });
    expect(checkNewPin('1111', null)).toEqual({ ok: false, reason: 'same_digit' });
    expect(checkNewPin('9876', null)).toEqual({ ok: false, reason: 'sequence' });
  });

  it('keeps digits only, up to the PIN length', () => {
    expect(digitsOnly('12a3 4-56789', 6)).toBe('123456');
    expect(pinComplete('2580', STAFF_PIN)).toBe(true);
    expect(pinComplete('258', STAFF_PIN)).toBe(false);
    expect(pinComplete('2580135', STAFF_PIN)).toBe(false);
  });

  it('checks an email loosely', () => {
    expect(looksLikeEmail(' owner@feelings.test ')).toBe(true);
    expect(looksLikeEmail('owner@feelings')).toBe(false);
  });
});

describe('next and test flags', () => {
  it('only follows same-origin app paths after sign-in', () => {
    expect(safeNext('/o/payroll?month=2026-10')).toBe('/o/payroll?month=2026-10');
    expect(safeNext('/')).toBe('/');
    expect(safeNext('//evil.test')).toBeNull();
    expect(safeNext('/\\evil.test')).toBeNull();
    expect(safeNext('https://evil.test')).toBeNull();
    expect(safeNext('/signin?next=/o')).toBeNull();
    expect(safeNext('/x y')).toBeNull();
    expect(safeNext(null)).toBeNull();
    expect(nextFitsRole('/o/today', 'owner')).toBe(true);
    expect(nextFitsRole('/o/today', 'staff')).toBe(false);
    expect(nextFitsRole('/month', 'staff')).toBe(true);
    expect(nextFitsRole('/month', 'manager')).toBe(false);
  });

  it('honours ?allowBrowser=1 on localhost and previews, never in production', () => {
    expect(allowBrowserFrom('?allowBrowser=1', 'localhost', false)).toBe(true);
    expect(allowBrowserFrom('', 'feelings-staff-pr-7.example.workers.dev', true)).toBe(true);
    expect(allowBrowserFrom('?allowBrowser=1', 'staff.feelingsbeautycare.in', true)).toBe(false);
    expect(allowBrowserFrom('', 'localhost', false)).toBe(false);
    expect(withAllowBrowser('/join?code=K7M4QPXD', true)).toBe(
      '/join?code=K7M4QPXD&allowBrowser=1',
    );
    expect(withAllowBrowser('/', false)).toBe('/');
  });

  it('draws the invite QR as one path', () => {
    const qr = qrPath('https://staff.feelingsbeautycare.in/join/K7M4QPXD');
    expect(qr.size).toBeGreaterThanOrEqual(25);
    expect(qr.d.startsWith('M')).toBe(true);
  });
});
