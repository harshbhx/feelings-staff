import { describe, expect, it } from 'vitest';
import {
  addDays,
  canonicalJson,
  daysInMonth,
  floorToMinute,
  formatDuration,
  formatJoinCode,
  formatRupees,
  fromBase64Url,
  isoWeekDates,
  isoWeekOf,
  istDate,
  istTime,
  istToEpoch,
  nameWithInitial,
  normaliseCode,
  normaliseIndianPhone,
  pinProblem,
  punchSigningPayload,
  toBase64Url,
  weekday,
} from '../src';

describe('IST time helpers', () => {
  it('converts between IST wall clock and epoch', () => {
    const t = istToEpoch('2026-10-19', '10:02');
    expect(new Date(t).toISOString()).toBe('2026-10-19T04:32:00.000Z');
    expect(istDate(t)).toBe('2026-10-19');
    expect(istTime(t)).toBe('10:02');
    expect(istDate(istToEpoch('2026-10-19', '23:59'))).toBe('2026-10-19');
    expect(istDate(istToEpoch('2026-10-19', '02:00', 1))).toBe('2026-10-20');
  });

  it('floors to the minute', () => {
    const t = istToEpoch('2026-10-19', '10:10') + 59_999;
    expect(istTime(floorToMinute(t))).toBe('10:10');
  });

  it('handles calendar arithmetic', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysInMonth('2026-10')).toBe(31);
    expect(daysInMonth('2028-02')).toBe(29);
    expect(weekday('2026-10-19')).toBe(1); // Monday
    expect(isoWeekOf('2026-10-19')).toBe('2026-W43');
    expect(isoWeekDates('2026-W43')[0]).toBe('2026-10-19');
    expect(isoWeekDates('2026-W43')[6]).toBe('2026-10-25');
    expect(isoWeekOf('2027-01-01')).toBe('2026-W53');
  });
});

describe('text helpers', () => {
  it('normalises Indian phone numbers', () => {
    expect(normaliseIndianPhone('98765 43210')).toBe('+919876543210');
    expect(normaliseIndianPhone('+91-98765-43210')).toBe('+919876543210');
    expect(normaliseIndianPhone('09876543210')).toBe('+919876543210');
    expect(normaliseIndianPhone('919876543210')).toBe('+919876543210');
    expect(normaliseIndianPhone('12345')).toBeNull();
    expect(normaliseIndianPhone('5876543210')).toBeNull();
  });

  it('normalises and formats join codes', () => {
    expect(normaliseCode('k7m-4qpxd')).toBe('K7M4QPXD');
    expect(normaliseCode('K7M4QPXO')).toBe('K7M4QPX0');
    expect(normaliseCode('K7M4QPXU')).toBeNull();
    expect(normaliseCode('K7M')).toBeNull();
    expect(formatJoinCode('K7M4QPXD')).toBe('K7M-4QPXD');
  });

  it('applies the PIN rules', () => {
    expect(pinProblem('1111')).toBe('same_digit');
    expect(pinProblem('0000')).toBe('same_digit');
    expect(pinProblem('1234')).toBe('sequence');
    expect(pinProblem('4321')).toBe('sequence');
    expect(pinProblem('7890')).toBe('sequence');
    expect(pinProblem('3210', '+919876543210')).toBe('sequence');
    expect(pinProblem('543210', '+919876543210')).toBe('sequence');
    expect(pinProblem('3219', '+919876543219')).toBe('phone_digits');
    expect(pinProblem('2580')).toBeNull();
    expect(pinProblem('12a4')).toBe('format');
  });

  it('formats money, durations and names', () => {
    expect(formatRupees(1500000)).toBe('₹15,000.00');
    expect(formatRupees(1500000, { whole: true })).toBe('₹15,000');
    expect(formatRupees(-1344)).toBe('−₹13.44');
    expect(formatRupees(1234567890)).toBe('₹1,23,45,678.90');
    expect(formatDuration(545)).toBe('9 h 05 m');
    expect(formatDuration(37)).toBe('37 m');
    expect(nameWithInitial('Priya Shah')).toBe('Priya S.');
    expect(nameWithInitial('Neha')).toBe('Neha');
  });
});

describe('canonical JSON', () => {
  it('sorts keys and drops undefined members', () => {
    expect(canonicalJson({ b: 1, a: [true, null, 'x'], c: undefined })).toBe(
      '{"a":[true,null,"x"],"b":1}',
    );
    expect(canonicalJson({ n: 1.5, z: 1e21 })).toBe('{"n":1.5,"z":1e+21}');
    expect(() => canonicalJson({ n: Number.NaN })).toThrow();
  });

  it('excludes signature, pin and the pin envelope from the signed payload', () => {
    const s = punchSigningPayload({
      v: 1,
      kind: 'in',
      pin: '2580',
      signature: 'abc',
      offline: {
        lastServerTime: 1,
        timeSig: 't',
        perfDeltaMs: 2,
        wallDeltaMs: 3,
        pinEnvelope: 'secret',
      },
    });
    expect(s).not.toContain('2580');
    expect(s).not.toContain('secret');
    expect(s).not.toContain('abc');
    expect(s).toBe(
      '{"kind":"in","offline":{"lastServerTime":1,"perfDeltaMs":2,"timeSig":"t","wallDeltaMs":3},"v":1}',
    );
  });

  it('round-trips base64url', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect([...fromBase64Url(toBase64Url(bytes))]).toEqual([...bytes]);
    expect(toBase64Url(new Uint8Array([255, 255]))).toBe('__8');
  });
});
