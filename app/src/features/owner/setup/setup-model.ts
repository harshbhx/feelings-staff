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

/**
 * How the checklist is laid out: the next step to do leads, the other open steps follow, and the
 * finished ones fold into one line. A skipped step stays open (it can still be finished) but is
 * never the lead, so a finished setup has no step competing with "Go to Today".
 */
export function setupLayout(steps: Partial<Record<SetupStep, SetupStepState>>) {
  const state = (s: SetupStep): SetupStepState => steps[s] ?? 'todo';
  const next = STEPS.find((s) => state(s) === 'todo') ?? null;
  return {
    next,
    /** Steps still to do after the lead, then skipped ones, in checklist order. */
    open: STEPS.filter((s) => s !== next && state(s) !== 'done'),
    done: STEPS.filter((s) => state(s) === 'done'),
    total: STEPS.length,
  };
}
