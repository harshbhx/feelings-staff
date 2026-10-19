/**
 * Settings as data (PRD 4.17, O-16): each rule is a field with where it lives in `OrgSettings`, how
 * it is edited, and a one-line "what this does" that reads the current value. Sections are lists of
 * fields; the form keeps a draft and sends only what changed, as a shallow-partial patch.
 */
import type { OrgSettings, OrgSettingsPatch } from '@fs/contracts';

type Section = Exclude<keyof OrgSettings, 'setup'>;

export interface FieldBase {
  /** Section and key, e.g. ['attendance', 'graceMin'], or a nested key in pay. */
  path: readonly [Section, string] | readonly [Section, string, string];
  /** `owner:settings.f.<id>.label` and `.what` (the what may use {{value}}). */
  id: string;
  /** The server asks for the owner PIN for this one (PRD 9.4). */
  stepUp?: boolean;
}

export type Field =
  | (FieldBase & { kind: 'stepper'; min: number; max: number; step: number; unit?: string })
  | (FieldBase & { kind: 'switch' })
  | (FieldBase & { kind: 'choice'; options: readonly (string | number)[] })
  | (FieldBase & { kind: 'time' })
  | (FieldBase & { kind: 'text'; maxLength: number })
  | (FieldBase & { kind: 'rupees'; nullable?: boolean })
  | (FieldBase & { kind: 'otRate' });

export type Values = Record<string, unknown>;

export const keyOf = (f: Pick<FieldBase, 'path'>): string => f.path.join('.');

/** The current value of a field in the saved settings. */
export function readField(settings: OrgSettings, f: Pick<FieldBase, 'path'>): unknown {
  let v: unknown = settings;
  for (const p of f.path) v = (v as Record<string, unknown> | undefined)?.[p];
  return v;
}

/** Fields whose draft differs from the saved value. */
export function changedFields(settings: OrgSettings, fields: readonly Field[], draft: Values) {
  return fields.filter(
    (f) =>
      keyOf(f) in draft &&
      JSON.stringify(draft[keyOf(f)]) !== JSON.stringify(readField(settings, f)),
  );
}

/** The patch for the changed fields: `{ attendance: { graceMin: 12 } }`, nested keys merged. */
export function buildPatch(
  settings: OrgSettings,
  fields: readonly Field[],
  draft: Values,
): OrgSettingsPatch {
  const patch: Record<string, Record<string, unknown>> = {};
  for (const f of changedFields(settings, fields, draft)) {
    const [section, key, sub] = f.path;
    const into = patch[section] ?? {};
    patch[section] = into;
    const value = draft[keyOf(f)];
    if (sub === undefined) into[key] = value;
    else
      into[key] = { ...((into[key] as Record<string, unknown> | undefined) ?? {}), [sub]: value };
  }
  return patch as OrgSettingsPatch;
}

/** Whether saving these changes will ask for the owner PIN. */
export function needsStepUp(settings: OrgSettings, fields: readonly Field[], draft: Values) {
  return changedFields(settings, fields, draft).some((f) => f.stepUp === true);
}

/** Overtime rate as one choice: "x2", "x1.5", "x1", "comp_off", "unpaid" (flat stays as it is). */
export type OtChoice = 'x2' | 'x1.5' | 'x1' | 'comp_off' | 'unpaid' | 'flat';
export const OT_CHOICES: readonly OtChoice[] = ['x2', 'x1.5', 'x1', 'comp_off', 'unpaid'];

export function otChoice(rate: OrgSettings['overtime']['rate']): OtChoice {
  if (rate.mode === 'multiplier') return `x${rate.multiplier}` as OtChoice;
  return rate.mode;
}

export function otRate(
  choice: OtChoice,
  current: OrgSettings['overtime']['rate'],
): OrgSettings['overtime']['rate'] {
  switch (choice) {
    case 'x2':
      return { mode: 'multiplier', multiplier: 2 };
    case 'x1.5':
      return { mode: 'multiplier', multiplier: 1.5 };
    case 'x1':
      return { mode: 'multiplier', multiplier: 1 };
    case 'comp_off':
      return { mode: 'comp_off' };
    case 'unpaid':
      return { mode: 'unpaid' };
    case 'flat':
      return current;
  }
}
