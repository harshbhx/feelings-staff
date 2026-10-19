/** Setup checklist order and progress (PRD 4.15.1, O-02.3: every step can be skipped and resumed). */
import type { SetupStep, SetupStepState } from '@fs/contracts';

export const STEPS: readonly SetupStep[] = [
  'salon',
  'location',
  'shifts',
  'holidays',
  'pay_rules',
  'selfie',
  'first_staff',
  'install',
];

/** Steps done or skipped, out of all (a skipped step still counts as handled). */
export function setupProgress(steps: Partial<Record<SetupStep, SetupStepState>>) {
  const handled = STEPS.filter((s) => steps[s] === 'done' || steps[s] === 'skipped').length;
  const next = STEPS.find((s) => (steps[s] ?? 'todo') === 'todo') ?? null;
  return { handled, total: STEPS.length, next };
}
