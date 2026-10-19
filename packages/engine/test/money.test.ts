import { describe, expect, it } from 'vitest';
import {
  add,
  cmp,
  div,
  formatInr,
  formatNum,
  formatRate,
  frac,
  fromDecimal,
  maxQ,
  minQ,
  mul,
  roundHalfUp,
  roundToRupee,
  sub,
  sum,
  toPaise,
  ZERO,
} from '../src/money';

describe('exact fractions (PRD 7.1, ADR-06)', () => {
  it('reduces and keeps the denominator positive', () => {
    expect(frac(6, -4)).toEqual({ n: -3n, d: 2n });
    expect(frac(0, 5)).toEqual({ n: 0n, d: 1n });
    expect(frac(10n)).toEqual({ n: 10n, d: 1n });
    expect(() => frac(1, 0)).toThrow(RangeError);
  });

  it('adds, subtracts, multiplies and divides exactly', () => {
    const third = frac(1, 3);
    expect(add(third, frac(1, 6))).toEqual(frac(1, 2));
    expect(sub(third, frac(1, 2))).toEqual(frac(-1, 6));
    expect(mul(frac(1_500_000, 31), frac(3, 2))).toEqual(frac(4_500_000, 62));
    expect(div(frac(1, 2), frac(1, 4))).toEqual(frac(2));
    expect(sum([])).toEqual(ZERO);
    expect(sum([third, third, third])).toEqual(frac(1));
  });

  it('compares and picks the smaller or larger', () => {
    expect(cmp(frac(1, 3), frac(1, 2))).toBe(-1);
    expect(cmp(frac(2, 4), frac(1, 2))).toBe(0);
    expect(cmp(frac(3, 4), frac(1, 2))).toBe(1);
    expect(minQ(frac(1), frac(2))).toEqual(frac(1));
    expect(minQ(frac(3), frac(2))).toEqual(frac(2));
    expect(maxQ(frac(1), frac(2))).toEqual(frac(2));
    expect(maxQ(frac(3), frac(2))).toEqual(frac(3));
  });

  it('converts decimal settings exactly', () => {
    expect(fromDecimal(1.5)).toEqual(frac(3, 2));
    expect(fromDecimal(2)).toEqual(frac(2));
    expect(fromDecimal(2.25)).toEqual(frac(9, 4));
  });
});

describe('rounding (PRD 14.2 rounding)', () => {
  it.each([
    [frac(5, 2), 3n],
    [frac(-5, 2), -3n],
    [frac(12, 5), 2n],
    [frac(13, 5), 3n],
    [frac(-13, 5), -3n],
    [frac(7), 7n],
  ])('roundHalfUp(%o) = %s (ties away from zero)', (q, r) => {
    expect(roundHalfUp(q)).toBe(r);
  });

  it('a line is rounded once to the paisa: 15,000 / 31 = ₹483.87', () => {
    expect(toPaise(frac(1_500_000, 31))).toBe(48_387);
  });

  it.each([
    [1_403_226, 1_403_200],
    [1_500_050, 1_500_100],
    [1_500_049, 1_500_000],
    [1_198_745, 1_198_700],
    [-150, -200],
  ])('net %i paise rounds to %i (never more than 50 paise away)', (net, rounded) => {
    expect(roundToRupee(net)).toBe(rounded);
    expect(Math.abs(rounded - net)).toBeLessThanOrEqual(50);
  });
});

describe('Indian rupee formatting', () => {
  it.each([
    [1_500_000, false, '₹15,000'],
    [48_387, false, '₹483.87'],
    [1_234_567_890, false, '₹1,23,45,678.90'],
    [100, true, '₹1.00'],
    [-26, false, '−₹0.26'],
    [0, false, '₹0'],
    [99_999_900, false, '₹9,99,999'],
  ])('formatInr(%i, %s) = %s', (paise, always, text) => {
    expect(formatInr(paise, always)).toBe(text);
  });

  it('formats rates and numbers for formulas', () => {
    expect(formatRate(frac(1_500_000, 31))).toBe('₹483.87');
    expect(formatRate(frac(1_200_000, 30))).toBe('₹400.00');
    expect(formatNum(1.5)).toBe('1.5');
    expect(formatNum(2)).toBe('2');
    expect(formatNum(1 / 3)).toBe('0.33');
  });
});
