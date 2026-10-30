/**
 * Owner demo-data buttons (preview only; every route answers 404 outside `ENV=preview`, see
 * lib/preview-gate.ts and the `previewOnly` flag in the endpoint table). The same steps as
 * `scripts/seed-demo.mjs`, split so no request outlives the Worker limits: `seed` wipes and writes
 * the raw data, `recompute` runs a few days at a time, `finish` sets the time credits start date,
 * approves old overtime and finalises and pays last month. The client drives the steps.
 */
import { addDays, istDate } from '@fs/contracts';
import type { Handlers } from '../../lib/api';
import { fail } from '../../lib/errors';
import { requirePreview } from '../../lib/preview-gate';
import { loadOrg } from '../../lib/settings';
import { reseedDemo } from '../../seed/demo-admin';
import { bulkDecide, listActions } from '../../services/owner-actions';
import { draftForMonth, finaliseRun, markAllPaid } from '../../services/payroll';
import type { Ctx } from '../../services/ports';
import { applySettingsPatch, saveSettings } from './settings';

/** Longest chunk one `recompute` call accepts (about 10 s a day with 12 people on remote D1). */
export const MAX_RECOMPUTE_DAYS = 4;
/** Overtime from the last days stays in Needs action, like a salon whose owner keeps up. */
const OVERTIME_WAITS_DAYS = 3;

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Demo days are the last seven weeks; anything else is a mistake. */
function checkRange(ctx: Ctx, from: string, to: string): number {
  const today = istDate(ctx.now());
  const n = daysBetween(from, to) + 1;
  if (n < 1 || n > MAX_RECOMPUTE_DAYS)
    fail('VALIDATION', `Send between 1 and ${MAX_RECOMPUTE_DAYS} days at a time.`);
  if (to > today || daysBetween(from, today) > 60)
    fail('VALIDATION', 'Those days are outside the demo range.');
  return n;
}

export const handlers: Handlers = {
  async ownerDemoSeed({ body }, ctx) {
    requirePreview(ctx.env);
    if (body.mode === 'load') {
      const staff = await ctx.db.first<{ n: number }>(
        "SELECT COUNT(*) AS n FROM users WHERE org_id = ?org AND role <> 'owner'",
      );
      if ((staff?.n ?? 0) > 0)
        fail('CONFLICT', 'Demo data is already loaded. Use Reset demo data to start again.');
    }
    return reseedDemo(ctx.env, ctx.env.DB, ctx.session, ctx.now());
  },

  async ownerDemoRecompute({ body }, ctx) {
    requirePreview(ctx.env);
    const days = checkRange(ctx, body.from, body.to);
    let people = 0;
    for (let d = body.from; d <= body.to; d = addDays(d, 1)) {
      const rows = await ctx.db.all<{ user_id: string }>(
        `SELECT p.user_id FROM staff_profiles p JOIN users u ON u.id = p.user_id
          WHERE p.org_id = ?org AND u.status IN ('active', 'invited') AND p.join_date <= ?`,
        d,
      );
      for (const r of rows) await ctx.services.days.recompute(ctx, r.user_id, d);
      people = rows.length;
    }
    return { from: body.from, to: body.to, days, people };
  },

  async ownerDemoFinish({ body }, ctx) {
    requirePreview(ctx.env);
    const today = istDate(ctx.now());

    // Time credits count from the start date, so it moves to the first seeded day.
    const { org, settings } = await loadOrg(ctx);
    const after = applySettingsPatch(settings, { timeCredits: { startDate: body.from } });
    if (after.timeCredits.startDate !== settings.timeCredits.startDate)
      await saveSettings(ctx, org, settings, after, 'demo data');

    // Overtime older than three days is decided; the last days stay in Needs action.
    const cutoff = addDays(today, -OVERTIME_WAITS_DAYS);
    const actions = await listActions(ctx, 'overtime');
    const ids = actions.items
      .filter((i) => i.type === 'overtime' && i.workDate < cutoff)
      .map((i) => i.id);
    let overtimeApproved = 0;
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const r = await bulkDecide(ctx, { type: 'overtime', ids: chunk, decision: 'approve' });
      overtimeApproved += r.done.length;
    }

    // Last month's payroll: draft, finalise, mark paid. A repeat after a failure picks up where it stopped.
    const payrollMonth = addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
    const existing = await ctx.db.first<{ id: string; status: string }>(
      "SELECT id, status FROM payroll_runs WHERE org_id = ?org AND month = ? AND status <> 'superseded' ORDER BY revision DESC LIMIT 1",
      payrollMonth,
    );
    let runId = existing?.id;
    let status = existing?.status;
    if (!runId) {
      runId = (await draftForMonth(ctx, payrollMonth)).run.id;
      status = 'draft';
    }
    if (status === 'draft') await finaliseRun(ctx, runId, true);
    const thirdOfThisMonth = `${today.slice(0, 7)}-03`;
    const paid = await markAllPaid(ctx, runId, {
      paidOn: today < thirdOfThisMonth ? today : thirdOfThisMonth,
      mode: 'upi',
    });
    return {
      creditsStart: body.from,
      overtimeApproved,
      payrollMonth,
      payrollPaid: paid.totals.paidCount >= paid.totals.people,
    };
  },
};
