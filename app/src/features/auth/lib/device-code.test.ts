import { describe, expect, it } from 'vitest';
import { groupCode, minutesLeft, spokenCode } from './device-code';

describe('device request code', () => {
  it('groups the code in threes and spells it for screen readers', () => {
    expect(groupCode('482913')).toBe('482 913');
    expect(spokenCode('482913')).toBe('4 8 2 9 1 3');
  });

  it('counts whole minutes left, rounded up, never below 0', () => {
    const now = 1_000_000;
    expect(minutesLeft(now + 15 * 60_000, now)).toBe(15);
    expect(minutesLeft(now + 14 * 60_000 + 1, now)).toBe(15);
    expect(minutesLeft(now + 60_000, now)).toBe(1);
    expect(minutesLeft(now + 1, now)).toBe(1);
    expect(minutesLeft(now, now)).toBe(0);
    expect(minutesLeft(now - 5_000, now)).toBe(0);
  });
});
