import type { SettingsView } from '@fs/contracts';
import { fixtures } from '@fs/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { buildPatch, changedFields, type Field, needsStepUp, otChoice, otRate } from './fields';

const view = fixtures.ownerSettingsGet as SettingsView;
const s = view.settings;
const FIELDS: Field[] = [
  { id: 'grace', path: ['attendance', 'graceMin'], kind: 'stepper', min: 0, max: 30, step: 1 },
  { id: 'strong', path: ['attendance', 'strongMode'], kind: 'switch', stepUp: true },
  { id: 'minWageAmount', path: ['pay', 'minimumWage', 'amountPaise'], kind: 'rupees' },
  { id: 'minWage', path: ['pay', 'minimumWage', 'enabled'], kind: 'switch' },
];

describe('Settings fields (O-16)', () => {
  it('O-16.1 only changed fields go into the patch, nested keys merged', () => {
    const draft = {
      'attendance.graceMin': s.attendance.graceMin,
      'pay.minimumWage.amountPaise': 1_200_000,
      'pay.minimumWage.enabled': !s.pay.minimumWage.enabled,
    };
    expect(changedFields(s, FIELDS, draft).map((f) => f.id)).toEqual(['minWageAmount', 'minWage']);
    expect(buildPatch(s, FIELDS, draft)).toEqual({
      pay: { minimumWage: { amountPaise: 1_200_000, enabled: !s.pay.minimumWage.enabled } },
    });
  });

  it('O-16.1 strong mode asks for the PIN before saving; grace does not', () => {
    expect(needsStepUp(s, FIELDS, { 'attendance.graceMin': 12 })).toBe(false);
    expect(needsStepUp(s, FIELDS, { 'attendance.strongMode': !s.attendance.strongMode })).toBe(
      true,
    );
  });

  it('overtime pay is one choice that maps to the rate', () => {
    expect(otChoice({ mode: 'multiplier', multiplier: 1.5 })).toBe('x1.5');
    expect(otRate('x2', s.overtime.rate)).toEqual({ mode: 'multiplier', multiplier: 2 });
    expect(otRate('comp_off', s.overtime.rate)).toEqual({ mode: 'comp_off' });
  });
});
