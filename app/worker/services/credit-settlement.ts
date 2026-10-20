/**
 * Credit settlements inside a payroll run (PRD 7.17.5, 4.19.3). The owner picks minutes per person
 * while the run is a draft; Finalise applies them (the balance drops, the payslip carries the
 * `time_credits` line), Reopen voids them and hands the same choices to the new revision. Owner: WP-9.
 */
import type { CreditSettlementResult, MinuteRate } from '@fs/contracts';
import { ulid } from '../lib/ulid';
import type { CreditSettlementRow } from './credit-entries';
import type { PersonCalc, RunRow } from './payroll-calc';
import type { Ctx } from './ports';

/** What the payroll calculation knows about one person's credits (PRD 7.17). */
export interface PersonCredit {
  /** Balance on the month end, before this run's settlement. */
  balanceMin: number;
  /** The owner's choice (0 when nothing is settled). */
  settleMin: number;
  rate: MinuteRate;
  /** What the engine applied (cap, rounding); null when nothing is settled. */
  applied: CreditSettlementResult | null;
}

/** The settlement rows of a draft run by person. */
export async function draftSettlements(
  ctx: Ctx,
  runId: string,
): Promise<Map<string, CreditSettlementRow>> {
  const rows = await ctx.db.all<CreditSettlementRow>(
    `SELECT * FROM credit_settlements WHERE org_id = ?org AND payroll_run_id = ? AND status = 'draft'`,
    runId,
  );
  return new Map(rows.map((r) => [r.user_id, r]));
}

/** The applied settlements of a finalised run by person. */
export async function appliedSettlements(
  ctx: Ctx,
  runId: string,
): Promise<Map<string, CreditSettlementRow>> {
  const rows = await ctx.db.all<CreditSettlementRow>(
    `SELECT * FROM credit_settlements WHERE org_id = ?org AND payroll_run_id = ? AND status = 'applied'`,
    runId,
  );
  return new Map(rows.map((r) => [r.user_id, r]));
}

/**
 * Finalise: every draft settlement becomes `applied` with the numbers the payslips were frozen with,
 * each with its audit row (`credits.settle`). A draft for someone who is no longer in the run is
 * voided.
 */
export async function applyStmts(
  ctx: Ctx,
  run: RunRow,
  people: readonly PersonCalc[],
  now: number,
): Promise<D1PreparedStatement[]> {
  const drafts = await draftSettlements(ctx, run.id);
  const actorId = ctx.user?.id ?? 'system';
  const stmts: D1PreparedStatement[] = [];
  const inRun = new Set(people.map((p) => p.profile.user_id));
  for (const [userId, row] of drafts) {
    const p = people.find((x) => x.profile.user_id === userId);
    if (!inRun.has(userId) || !p) {
      stmts.push(
        ctx.db.update('credit_settlements', { status: 'void' }, 'id = ?', row.id),
        ctx.services.audit.stmt(ctx, {
          category: 'change',
          action: 'credits.settle',
          entity: 'credit_settlement',
          entityId: row.id,
          before: { status: 'draft', settleMin: row.settle_min },
          after: { status: 'void', runId: run.id },
          reason: 'Not part of the payroll at finalise',
        }),
      );
      continue;
    }
    const c = p.credit;
    const applied = c.applied ?? { appliedMin: 0, amountPaise: 0, stayMin: c.balanceMin };
    stmts.push(
      ctx.db.update(
        'credit_settlements',
        {
          status: 'applied',
          balance_min: c.balanceMin,
          settle_min: c.settleMin,
          applied_min: applied.appliedMin,
          amount_paise: applied.amountPaise,
          rate_json: JSON.stringify(c.rate),
          warnings_json: JSON.stringify(p.result.warnings),
          decided_by: actorId,
          decided_at: now,
        },
        'id = ?',
        row.id,
      ),
      ctx.services.audit.stmt(ctx, {
        category: 'change',
        action: 'credits.settle',
        entity: 'credit_settlement',
        entityId: row.id,
        before: { status: 'draft', settleMin: row.settle_min },
        after: {
          status: 'applied',
          runId: run.id,
          month: run.month,
          userId,
          balanceMin: c.balanceMin,
          settleMin: c.settleMin,
          appliedMin: applied.appliedMin,
          amountPaise: applied.amountPaise,
        },
      }),
    );
  }
  return stmts;
}

/**
 * Reopen: the old revision's applied settlements are voided and the new draft gets the same choices
 * back (the stepper comes back with the same values), each with an audit row.
 */
export async function reopenStmts(
  ctx: Ctx,
  oldRun: RunRow,
  newRunId: string,
  now: number,
): Promise<D1PreparedStatement[]> {
  const applied = await appliedSettlements(ctx, oldRun.id);
  const actorId = ctx.user?.id ?? 'system';
  const stmts: D1PreparedStatement[] = [];
  for (const [userId, row] of applied) {
    const id = ulid(now);
    stmts.push(
      ctx.db.update('credit_settlements', { status: 'void' }, 'id = ?', row.id),
      ctx.db.insert('credit_settlements', {
        id,
        user_id: userId,
        payroll_run_id: newRunId,
        month: row.month,
        balance_min: row.balance_min,
        settle_min: row.settle_min,
        applied_min: 0,
        amount_paise: 0,
        rate_json: row.rate_json,
        warnings_json: '[]',
        status: 'draft',
        decided_by: actorId,
        decided_at: now,
        note: row.note,
      }),
      ctx.services.audit.stmt(ctx, {
        category: 'change',
        action: 'credits.settle',
        entity: 'credit_settlement',
        entityId: row.id,
        before: { status: 'applied', appliedMin: row.applied_min, runId: oldRun.id },
        after: { status: 'void', newDraftId: id, runId: newRunId },
        reason: 'Payroll reopened',
      }),
    );
  }
  return stmts;
}
