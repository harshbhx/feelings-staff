import { ApiError } from '@fs/contracts';
import { describe, expect, it } from 'vitest';
import {
  belowMinimumWage,
  createProblem,
  emptyStaffForm,
  rupeesToPaise,
  toStaffCreate,
  validateStaff,
} from './staff-form';

const TEMPLATE = '01K8GSSSMCEJBEG2FMPXQCZR0J';

describe('Add staff form (O-07)', () => {
  it('O-07.1 a filled form becomes a StaffCreate with E.164 phone and paise', () => {
    const v = {
      ...emptyStaffForm('2026-10-19', TEMPLATE),
      name: ' Bhumi Trivedi ',
      phone: '090169 32212',
      designation: 'Trainee' as const,
      salary: '9,500',
      weekOffDow: 3,
      adult: true,
    };
    expect(validateStaff(v)).toEqual({});
    expect(toStaffCreate(v)).toEqual({
      name: 'Bhumi Trivedi',
      phone: '+919016932212',
      designation: 'Trainee',
      joinDate: '2026-10-19',
      salaryType: 'monthly',
      salaryAmountPaise: 950000,
      defaultTemplateId: TEMPLATE,
      weekOffDow: 3,
      lang: 'en',
      selfieRequired: null,
      adultConfirmed: true,
    });
  });

  it('names every missing or wrong field in words', () => {
    const errors = validateStaff({ ...emptyStaffForm('2026-10-19', ''), phone: '12345' });
    expect(Object.keys(errors).sort()).toEqual(
      ['adult', 'designation', 'name', 'phone', 'salary', 'templateId'].sort(),
    );
  });

  it('reads rupees as typed', () => {
    expect(rupeesToPaise('₹15,000')).toBe(1500000);
    expect(rupeesToPaise('480.50')).toBe(48050);
    expect(rupeesToPaise('0')).toBeNull();
    expect(rupeesToPaise('abc')).toBeNull();
  });

  it('O-07.3 a duplicate phone offers to edit the person; an exited one offers rehire', () => {
    const dup = new ApiError({
      code: 'DUPLICATE',
      status: 409,
      details: { name: 'Priya Solanki', staffId: '01K86AFQDXWDHQ8238N67SVDDK', status: 'active' },
    });
    expect(createProblem(dup)).toEqual({
      kind: 'duplicate',
      name: 'Priya Solanki',
      staffId: '01K86AFQDXWDHQ8238N67SVDDK',
    });
    const left = new ApiError({
      code: 'DUPLICATE',
      status: 409,
      details: { name: 'Anita Joshi', staffId: 'X', status: 'exited', exitDate: '2026-08-03' },
    });
    expect(createProblem(left)).toMatchObject({ kind: 'rehire', exitDate: '2026-08-03' });
  });

  it('shows the 15-active-staff cap message from the API as it is', () => {
    const cap = new ApiError({
      code: 'RULE_VIOLATION',
      status: 422,
      message: 'You already have 15 active staff.',
    });
    expect(createProblem(cap)).toEqual({
      kind: 'cap',
      message: 'You already have 15 active staff.',
    });
    expect(createProblem(new Error('offline'))).toEqual({ kind: 'network' });
  });

  it('warns below the minimum wage only when the owner set one', () => {
    const mw = { enabled: true, amountPaise: 1332500, basis: 'monthly' as const };
    expect(belowMinimumWage(1100000, 'monthly', mw)).toBe(true);
    expect(belowMinimumWage(1500000, 'monthly', mw)).toBe(false);
    expect(belowMinimumWage(1100000, 'monthly', { ...mw, amountPaise: null })).toBe(false);
  });
});
