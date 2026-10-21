import { Designation } from '@fs/contracts';
import { describe, expect, it } from 'vitest';
import { roleTone } from './people';

describe('role tones (redesign Fix 5)', () => {
  it('maps every designation to a service tone or ink', () => {
    const tones = Object.fromEntries(Designation.options.map((d) => [d, roleTone(d)]));
    expect(tones).toEqual({
      Stylist: 'salon',
      Beautician: 'salon',
      'Makeup artist': 'makeup',
      'Mehndi artist': 'mehndi',
      'Nail technician': 'nails',
      Receptionist: 'neutral',
      Helper: 'neutral',
      Trainer: 'trainee',
      Trainee: 'trainee',
      Other: 'neutral',
    });
  });

  it('a missing or unknown designation is ink', () => {
    expect(roleTone(null)).toBe('neutral');
    expect(roleTone(undefined)).toBe('neutral');
    expect(roleTone('')).toBe('neutral');
    expect(roleTone('Nail artist')).toBe('neutral');
  });
});
