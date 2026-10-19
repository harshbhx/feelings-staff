/**
 * The nightly job at 03:00 IST (PRD 9.5): close the previous work date (absent marking through the
 * engine), retention purge, comp-off expiry, CL/SL credit on 1 January, and, on the 1st of the
 * month, the five-year purge. Each step is claimed in `cron_runs`. Owner: WP-8.
 */
import { addDays, istDate } from '@fs/contracts';
import type { Env } from '../env';
import { loadOrg } from '../lib/settings';
import { ulid } from '../lib/ulid';
import type { Ctx } from '../services/ports';
import { once, systemCtx } from './context';
import { purgeMonthly, purgeNightly, writePurgeAudit } from './retention';

const JOB = 'nightly';

export async function runNightly(
  env: Env,
  orgId: string,
  at: number,
): Promise<Record<string, number>> {
  const { ctx, settle } = await systemCtx(env, orgId, at);
  const date = istDate(at);
  const counts: Record<string, number> = {};
  const add = (k: string, n: number) => {
    counts[k] = (counts[k] ?? 0) + n;
  };

  const step = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      console.error(JSON.stringify({ msg: 'cron.step_error', step: name, error: String(e) }));
    }
  };

  await step('absent', async () => {
    await once(ctx, JOB, `${date}|absent`, async () => {
      add('days_recomputed', await markAbsent(ctx, addDays(date, -1)));
    });
  });

  await step('retention', async () => {
    const { settings } = await loadOrg(ctx);
    await once(ctx, JOB, `${date}|retention`, async () => {
      const purged = await purgeNightly(ctx, at, settings);
      let monthly: Record<string, number> = {};
      if (date.endsWith('-01')) monthly = await purgeMonthly(ctx, at);
      for (const [k, v] of Object.entries({ ...purged, ...monthly })) add(`purged_${k}`, v);
      await writePurgeAudit(ctx, { ...purged, ...monthly });
    });
  });

  await step('comp_off', async () => {
    await once(ctx, JOB, `${date}|comp_off_expiry`, async () => {
      add('comp_off_expired', await expireCompOff(ctx, date, at));
    });
  });

  if (date.endsWith('-01-01'))
    await step('annual_credit', async () => {
      await once(ctx, JOB, `${date}|annual_credit`, async () => {
        add('leave_credits', await creditAnnualLeave(ctx, date, at));
      });
    });

  await settle();
  return counts;
}

/** Recompute yesterday for everyone employed then; the engine marks no-shows `A` (PRD 9.5). */
async function markAbsent(ctx: Ctx, workDate: string): Promise<number> {
  const people = await ctx.db.all<{ id: string }>(
    `SELECT u.id FROM users u JOIN staff_profiles p ON p.user_id = u.id
      WHERE u.org_id = ?org AND u.status IN ('active', 'exited') AND p.join_date <= ?
        AND (p.exit_date IS NULL OR p.exit_date >= ?)`,
    workDate,
    workDate,
  );
  let n = 0;
  for (const p of people) {
    try {
      await ctx.services.days.recompute(ctx, p.id, workDate);
      n += 1;
    } catch (e) {
      console.error(JSON.stringify({ msg: 'cron.recompute_failed', error: String(e) }));
    }
  }
  return n;
}

/**
 * Comp-off credits past their expiry date lapse (PRD 7.8): what is left of them becomes one
 * `expire` entry. Credits are used oldest first, so the lapsing amount is capped by the balance.
 */
async function expireCompOff(ctx: Ctx, date: string, at: number): Promise<number> {
  const rows = await ctx.db.all<{
    user_id: string;
    leave_type_id: string;
    balance: number;
    lapsed_credits: number;
    already_expired: number;
  }>(
    `SELECT l.user_id, l.leave_type_id,
            SUM(CASE WHEN l.kind IN ('credit', 'adjust') THEN l.days ELSE -l.days END) AS balance,
            SUM(CASE WHEN l.kind = 'credit' AND l.expires_on IS NOT NULL AND l.expires_on < ? THEN l.days ELSE 0 END) AS lapsed_credits,
            SUM(CASE WHEN l.kind = 'expire' THEN l.days ELSE 0 END) AS already_expired
       FROM leave_ledger l JOIN leave_types t ON t.id = l.leave_type_id
      WHERE l.org_id = ?org AND t.code = 'CO'
      GROUP BY l.user_id, l.leave_type_id`,
    date,
  );
  const stmts: D1PreparedStatement[] = [];
  for (const r of rows) {
    const days = Math.min(r.balance, r.lapsed_credits - r.already_expired);
    if (days <= 0) continue;
    stmts.push(
      ctx.db.insert('leave_ledger', {
        id: ulid(at),
        user_id: r.user_id,
        leave_type_id: r.leave_type_id,
        entry_date: date,
        kind: 'expire',
        days,
        ref_type: 'expiry',
        ref_id: date,
        note: 'Comp-off expired',
        created_by: 'system',
        created_at: at,
      }),
      ctx.services.audit.stmt(ctx, {
        category: 'change',
        action: 'leave.comp_off_expire',
        entity: 'leave_ledger',
        entityId: r.user_id,
        after: { days, date },
        actorType: 'system',
        actorId: null,
      }),
    );
  }
  await ctx.db.batch(stmts);
  return stmts.length / 2;
}

/** 1 January: CL and SL credits for everyone employed (PRD 7.8). Safe to run twice. */
async function creditAnnualLeave(ctx: Ctx, date: string, at: number): Promise<number> {
  const year = date.slice(0, 4);
  const types = await ctx.db.all<{ id: string; code: string; annual_quota: number | null }>(
    `SELECT id, code, annual_quota FROM leave_types
      WHERE org_id = ?org AND code IN ('CL', 'SL') AND active = 1 AND accrual = 'annual'`,
  );
  const people = await ctx.db.all<{ id: string }>(
    `SELECT u.id FROM users u JOIN staff_profiles p ON p.user_id = u.id
      WHERE u.org_id = ?org AND u.status = 'active'`,
  );
  const done = await ctx.db.all<{ user_id: string; leave_type_id: string }>(
    `SELECT user_id, leave_type_id FROM leave_ledger
      WHERE org_id = ?org AND ref_type = 'annual' AND ref_id = ?`,
    year,
  );
  const have = new Set(done.map((d) => `${d.user_id}|${d.leave_type_id}`));
  const stmts: D1PreparedStatement[] = [];
  let n = 0;
  for (const p of people)
    for (const t of types) {
      if (!t.annual_quota || have.has(`${p.id}|${t.id}`)) continue;
      stmts.push(
        ctx.db.insert('leave_ledger', {
          id: ulid(at),
          user_id: p.id,
          leave_type_id: t.id,
          entry_date: date,
          kind: 'credit',
          days: t.annual_quota,
          ref_type: 'annual',
          ref_id: year,
          note: `${t.code} credit for ${year}`,
          created_by: 'system',
          created_at: at,
        }),
      );
      n += 1;
    }
  if (n > 0)
    stmts.push(
      ctx.services.audit.stmt(ctx, {
        category: 'change',
        action: 'leave.annual_credit',
        entity: 'leave_ledger',
        after: { year, credits: n },
        actorType: 'system',
        actorId: null,
      }),
    );
  // D1 batches are limited, so write in groups of 100 statements.
  for (let i = 0; i < stmts.length; i += 100) await ctx.db.batch(stmts.slice(i, i + 100));
  return n;
}
