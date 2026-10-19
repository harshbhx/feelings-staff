/**
 * Step-up check (PRD 4.1.7): the owner PIN entered in the last 10 minutes. Owner: WP-3.
 * `POST /auth/step-up` sets `sessions.step_up_until = now + 10 min`; endpoints flagged `stepUp`
 * (and handlers that need it conditionally, such as salary changes) call `require`.
 */
import { fail } from '../lib/errors';
import type { StepUp } from './ports';

export const STEP_UP_MS = 10 * 60_000;

export function createStepUp(): StepUp {
  return {
    async require(ctx) {
      const until = ctx.session?.stepUpUntil ?? null;
      if (until !== null && until >= ctx.now()) return;
      let pinSet = true;
      if (ctx.user && ctx.orgId) {
        const row = await ctx.db.first<{ pin_set: number }>(
          'SELECT pin_hash IS NOT NULL AS pin_set FROM users WHERE org_id = ?org AND id = ?',
          ctx.user.id,
        );
        pinSet = row?.pin_set === 1;
      }
      fail('STEP_UP_REQUIRED', undefined, { pinSet });
    },
  };
}
