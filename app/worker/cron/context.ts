/**
 * Cron plumbing (PRD 9.5): a system Ctx per org and the `cron_runs` guard that makes every action
 * run once per slot. Owner: WP-8.
 */
import { OrgDb, SystemDb } from '../db';
import type { Env } from '../env';
import { ulid } from '../lib/ulid';
import type { Ctx } from '../services/ports';
import { createServices } from '../services/registry';

export interface CronCtx {
  ctx: Ctx;
  /** Wait for everything handed to `ctx.waitUntil` (production pushes). */
  settle(): Promise<void>;
}

/** A context for one org with no session: the actor is `system`, and `now()` is the slot time. */
export async function systemCtx(env: Env, orgId: string, at: number): Promise<CronCtx> {
  const base = await createServices(env);
  const services = { ...base, clock: { now: () => at, fake: true } };
  const pending: Promise<unknown>[] = [];
  const db = new OrgDb(env.DB, orgId);
  const ctx: Ctx = {
    env,
    requestId: `cron-${ulid(at)}`,
    now: () => at,
    session: null,
    user: null,
    orgId,
    db,
    sys: new SystemDb(env.DB),
    ip: null,
    ipHmac: null,
    cf: null,
    waitUntil: (p) => {
      pending.push(
        p.catch((e) => console.error(JSON.stringify({ msg: 'cron.wait', error: String(e) }))),
      );
    },
    services,
  };
  return { ctx, settle: async () => void (await Promise.all(pending)) };
}

/** Claim a slot. True when this run owns it; false when an earlier tick already did the work. */
export async function claim(ctx: Ctx, job: string, slot: string): Promise<boolean> {
  const res = await ctx.db.run(
    'INSERT OR IGNORE INTO cron_runs (job, org_id, slot, ran_at) VALUES (?, ?org, ?, ?)',
    job,
    slot,
    ctx.now(),
  );
  return (res.meta.changes ?? 0) > 0;
}

export async function release(ctx: Ctx, job: string, slot: string): Promise<void> {
  await ctx.db.run('DELETE FROM cron_runs WHERE job = ? AND org_id = ?org AND slot = ?', job, slot);
}

/**
 * Run `fn` once for `slot`. If it throws, the claim is released so the next tick retries, and the
 * error is logged (never thrown: one failing rule must not stop the others).
 */
export async function once(
  ctx: Ctx,
  job: string,
  slot: string,
  fn: () => Promise<unknown>,
): Promise<boolean> {
  if (!(await claim(ctx, job, slot))) return false;
  try {
    const result = await fn();
    if (typeof result === 'string')
      await ctx.db.run(
        'UPDATE cron_runs SET result = ? WHERE job = ? AND org_id = ?org AND slot = ?',
        result,
        job,
        slot,
      );
    return true;
  } catch (e) {
    await release(ctx, job, slot);
    console.error(
      JSON.stringify({
        msg: 'cron.rule_failed',
        job,
        slot,
        requestId: ctx.requestId,
        error: String(e),
      }),
    );
    return false;
  }
}
