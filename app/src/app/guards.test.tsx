import { describe, expect, it } from 'vitest';
import { homeFor } from './guards';

describe('homes by role (PRD 5)', () => {
  it('sends staff to / and owners and managers to /o/today', () => {
    expect(homeFor('staff')).toBe('/');
    expect(homeFor('owner')).toBe('/o/today');
    expect(homeFor('manager')).toBe('/o/today');
  });
});
