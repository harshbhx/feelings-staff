import { describe, expect, it } from 'vitest';
import { formatDistance } from './distance';

describe('formatDistance', () => {
  it('shows 0 m', () => expect(formatDistance(0)).toBe('0 m'));
  it('rounds under 100 m to the nearest 5 m', () => {
    expect(formatDistance(42)).toBe('40 m');
    expect(formatDistance(43)).toBe('45 m');
    expect(formatDistance(97.4)).toBe('95 m');
  });
  it('rounds 100 m to under 1 km to the nearest 10 m', () => {
    expect(formatDistance(100)).toBe('100 m');
    expect(formatDistance(338)).toBe('340 m');
    expect(formatDistance(344)).toBe('340 m');
  });
  it('switches to km at 1000 m with one decimal', () => {
    expect(formatDistance(990)).toBe('990 m');
    expect(formatDistance(999)).toBe('1.0 km');
    expect(formatDistance(1000)).toBe('1.0 km');
    expect(formatDistance(1234)).toBe('1.2 km');
  });
  it('groups huge values with Indian grouping', () => {
    expect(formatDistance(12_345_000)).toBe('12,345.0 km');
    expect(formatDistance(12_345_000_000)).toBe('1,23,45,000.0 km');
  });
  it('guards negative, NaN, infinite and missing values', () => {
    for (const v of [-1, Number.NaN, Number.POSITIVE_INFINITY, null, undefined]) {
      expect(formatDistance(v)).toBeNull();
    }
  });
  it('formats for gu-IN with Latin digits', () => {
    const out = formatDistance(340, 'gu');
    expect(out).toMatch(/^340\s/);
    expect(formatDistance(1234, 'gu')).toMatch(/^1\.2\s/);
  });
});
