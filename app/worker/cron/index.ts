/**
 * Scheduled jobs (PRD 9.5). Owner: WP-8.
 * `*\/5 * * * *` -> rules, `30 21 * * *` -> nightly. Each action is guarded by a cron_runs row.
 */
import type { Env } from '../env';

export type JobName = 'rules' | 'nightly';

export function jobForCron(cron: string): JobName {
  return cron === '30 21 * * *' ? 'nightly' : 'rules';
}

/** Run one job as if it fired at `at` (epoch ms). Returns counts for logs and /__test/cron. */
export async function runJob(
  job: JobName,
  _env: Env,
  at: number,
): Promise<Record<string, unknown>> {
  return { job, at, implemented: false };
}
