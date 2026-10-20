/**
 * Weekly digest (PRD 6 N30, O-21): Monday from 09:00 IST the owner gets last week's summary in the
 * inbox and by email. One `cron_runs` slot per week start, so ticks that repeat or retry send it
 * once. Owner: WP-8.
 */
import { addDays, hhmmToMin, istDate, istTime, weekday } from '@fs/contracts';
import { weeklyDigest } from '../services/digest';
import type { Ctx } from '../services/ports';
import { once } from './context';

export const DIGEST_FROM_MIN = 9 * 60;

/** On Monday from 09:00 IST, send last week's digest once. True when this tick sent it. */
export async function weeklyDigestRule(ctx: Ctx, job: string): Promise<boolean> {
  const at = ctx.now();
  const date = istDate(at);
  if (weekday(date) !== 1 || hhmmToMin(istTime(at)) < DIGEST_FROM_MIN) return false;
  const weekStart = addDays(date, -7);
  return once(ctx, job, `${weekStart}|weekly_digest`, async () => {
    const d = await weeklyDigest(ctx, weekStart);
    await ctx.services.notifier.emit(ctx, {
      type: 'weekly_digest',
      orgId: ctx.orgId ?? '',
      at,
      weekStart,
      onTimePct: d.onTimePct,
      otApprovedMin: d.otApprovedMin,
      leaves: d.leaves,
    });
  });
}
