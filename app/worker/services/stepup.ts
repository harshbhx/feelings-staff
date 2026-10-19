/** Step-up check (PRD 4.1.7): owner PIN entered within the last 10 minutes. Owner: WP-3. */
import { fail } from '../lib/errors';
import type { StepUp } from './ports';

export const STEP_UP_MS = 10 * 60_000;

export function createStepUp(): StepUp {
  return {
    async require(ctx) {
      const until = ctx.session?.stepUpUntil ?? null;
      if (until === null || until < ctx.now()) {
        fail('STEP_UP_REQUIRED', undefined, { pinSet: true });
      }
    },
  };
}
