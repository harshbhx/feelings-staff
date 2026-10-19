import { describe, expect, it } from 'vitest';
import { describeChange } from './audit-model';

describe('Audit log rows (O-18)', () => {
  it('O-18.1 lists only the fields that changed, before and after', () => {
    expect(describeChange({ status: 'OPEN', note: 'x' }, { status: 'P', note: 'x' })).toEqual([
      { key: 'status', before: 'OPEN', after: 'P' },
    ]);
  });

  it('O-18.1 a created or deleted row shows its fields on one side only', () => {
    expect(describeChange(null, { name: 'Diwali' })).toEqual([
      { key: 'name', before: null, after: 'Diwali' },
    ]);
    expect(describeChange({ name: 'Diwali' }, null)).toEqual([
      { key: 'name', before: 'Diwali', after: null },
    ]);
  });

  it('nested values read as short text, never raw JSON', () => {
    const [line] = describeChange({ rate: { mode: 'multiplier', multiplier: 2 } }, { rate: { mode: 'comp_off' } });
    expect(line).toEqual({ key: 'rate', before: 'mode multiplier, multiplier 2', after: 'mode comp_off' });
  });
});
