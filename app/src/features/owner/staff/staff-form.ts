/**
 * Add-staff form (PRD 4.1.1): values as typed, validation in plain words, and the StaffCreate body.
 * Also reads the API's duplicate-phone, rehire and 15-active-staff answers into something the form
 * can show.
 */
import { ApiError, type Designation, normaliseIndianPhone, type StaffCreate } from '@fs/contracts';

export const DESIGNATIONS: readonly Designation[] = [
  'Stylist',
  'Beautician',
  'Makeup artist',
  'Mehndi artist',
  'Nail technician',
  'Receptionist',
  'Helper',
  'Trainer',
  'Trainee',
  'Other',
];

export interface StaffFormValues {
  name: string;
  phone: string;
  designation: Designation | '';
  /** Free text when designation is Other. */
  designationOther: string;
  joinDate: string;
  salaryType: 'monthly' | 'daily';
  /** Rupees as typed, e.g. "15,000". */
  salary: string;
  templateId: string;
  /** 0 = Sunday ... 6 = Saturday, or null for no fixed week-off. */
  weekOffDow: number | null;
  lang: 'en' | 'gu';
  /** null = follow the salon setting. */
  selfie: boolean | null;
  adult: boolean;
}

export type StaffField = 'name' | 'phone' | 'designation' | 'salary' | 'templateId' | 'adult';

export function emptyStaffForm(today: string, defaultTemplateId: string): StaffFormValues {
  return {
    name: '',
    phone: '',
    designation: '',
    designationOther: '',
    joinDate: today,
    salaryType: 'monthly',
    salary: '',
    templateId: defaultTemplateId,
    weekOffDow: null,
    lang: 'en',
    selfie: null,
    adult: false,
  };
}

/** "15,000" or "15000.50" -> paise; null when it is not a positive amount. */
export function rupeesToPaise(input: string): number | null {
  const clean = input.replace(/[₹,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const paise = Math.round(Number(clean) * 100);
  return paise > 0 ? paise : null;
}

/** Problems keyed by field, as `owner:staff.form.errors.*` keys. Empty means valid. */
export function validateStaff(v: StaffFormValues): Partial<Record<StaffField, string>> {
  const errors: Partial<Record<StaffField, string>> = {};
  if (!v.name.trim()) errors.name = 'owner:staff.form.errors.name';
  if (!normaliseIndianPhone(v.phone)) errors.phone = 'owner:staff.form.errors.phone';
  if (!v.designation || (v.designation === 'Other' && !v.designationOther.trim()))
    errors.designation = 'owner:staff.form.errors.designation';
  if (rupeesToPaise(v.salary) === null) errors.salary = 'owner:staff.form.errors.salary';
  if (!v.templateId) errors.templateId = 'owner:staff.form.errors.template';
  if (!v.adult) errors.adult = 'owner:staff.form.errors.adult';
  return errors;
}

/** The request body; call only after `validateStaff` returned no errors. */
export function toStaffCreate(v: StaffFormValues): StaffCreate {
  const phone = normaliseIndianPhone(v.phone);
  const salary = rupeesToPaise(v.salary);
  if (!phone || salary === null || !v.designation) throw new Error('validate first');
  return {
    name: v.name.trim(),
    phone,
    designation: v.designation === 'Other' ? v.designationOther.trim() : v.designation,
    joinDate: v.joinDate,
    salaryType: v.salaryType,
    salaryAmountPaise: salary,
    defaultTemplateId: v.templateId,
    weekOffDow: v.weekOffDow,
    lang: v.lang,
    selfieRequired: v.selfie,
    adultConfirmed: true,
  };
}

/** What the API said about the phone or the staff cap, in a shape the form can show. */
export type CreateProblem =
  /** The number belongs to an active person: offer "Edit Priya instead?". */
  | { kind: 'duplicate'; name: string | null; staffId: string | null }
  /** The number belongs to someone who left: offer "Rehire her?". */
  | { kind: 'rehire'; name: string | null; staffId: string | null; exitDate: string | null }
  /** 15 active staff already (Harsh, 19 Oct): the server's sentence, shown as is. */
  | { kind: 'cap'; message: string }
  | { kind: 'validation'; message: string }
  | { kind: 'network' };

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

export function createProblem(e: unknown): CreateProblem {
  if (!(e instanceof ApiError)) return { kind: 'network' };
  const d = e.details ?? {};
  if (e.code === 'DUPLICATE' || e.code === 'CONFLICT') {
    const exited = d.status === 'exited' || str(d.exitDate) !== null || d.rehire === true;
    const name = str(d.name);
    const staffId = str(d.staffId) ?? str(d.userId) ?? str(d.id);
    return exited
      ? { kind: 'rehire', name, staffId, exitDate: str(d.exitDate) }
      : { kind: 'duplicate', name, staffId };
  }
  if (e.code === 'RULE_VIOLATION') return { kind: 'cap', message: e.message };
  if (e.code === 'VALIDATION') return { kind: 'validation', message: e.message };
  return { kind: 'network' };
}

/** Minimum-wage notice under the salary field (amber, saving still allowed). */
export function belowMinimumWage(
  salaryPaise: number | null,
  salaryType: 'monthly' | 'daily',
  minimum: { enabled: boolean; amountPaise: number | null; basis: 'monthly' | 'daily' },
): boolean {
  if (salaryPaise === null || !minimum.enabled || minimum.amountPaise === null) return false;
  if (salaryType !== minimum.basis) return false;
  return salaryPaise < minimum.amountPaise;
}
