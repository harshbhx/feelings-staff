/**
 * Scheduled jobs (PRD 9.5). Owner: WP-8.
 * `*\/5 * * * *` -> rules, `30 21 * * *` (03:00 IST) -> nightly. Each action is guarded by a
 * cron_runs row, so a tick that repeats or retries never does anything twice. `runJob` is called by
 * the Worker's `scheduled()` and by POST /__test/cron with a chosen time.
 */
import { SystemDb } from '../db';
import type { Env } from '../env';
import { runNightly } from './nightly';
import { runRules } from './rules';

export type JobName = 'rules' | 'nightly';

export function jobForCron(cron: string): JobName {
  return cron === '30 21 * * *' ? 'nightly' : 'rules';
}

/** Run one job as if it fired at `at` (epoch ms). Returns counts for logs and /__test/cron. */
export async function runJob(job: JobName, env: Env, at: number): Promise<Record<string, unknown>> {
  const orgs = await new SystemDb(env.DB).all<{ id: string }>('SELECT id FROM orgs ORDER BY id');
  const perOrg: Record<string, unknown> = {};
  for (const { id } of orgs) {
    const started = Date.now();
    try {
      const counts = job === 'rules' ? await runRules(env, id, at) : await runNightly(env, id, at);
      perOrg[id] = counts;
      console.info(
        JSON.stringify({ msg: 'cron.org', job, org: id, ms: Date.now() - started, counts }),
      );
    } catch (e) {
      perOrg[id] = { error: String(e) };
      console.error(JSON.stringify({ msg: 'cron.org_failed', job, org: id, error: String(e) }));
    }
  }
  return { job, at, orgs: orgs.length, perOrg };
}
