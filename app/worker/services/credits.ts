/**
 * Time credits for the owner (PRD 4.19, 7.17, 9.4): the Credits overview, a person's ledger, adjustments
 * with a required reason, and the Settle credits step of a payroll run. Owner only: the routes that
 * call these are owner-only in the endpoint table, and no staff service imports them. Owner: WP-9.
 */
import {
  type CreditAdjustment,
  type CreditAdjustmentCreate,
  type CreditAdjustmentPatch,
  type CreditLedger,
  type CreditSettlement,
  type CreditSettleResult,
  type CreditsOverview,
  type CreditsSettleView,
  istDate,
  type MinuteRate,
} from '@fs/contracts';
import { creditValue } from '@fs/engine';
import { json } from '../db';
import { fail } from '../lib/errors';
import { loadOrg, loadSettings } from '../lib/settings';
import { ulid } from '../lib/ulid';
import {
  balanceOf,
  type CreditAdjustmentRow,
  type CreditSettlementRow,
  type LedgerRows,
  loadLedgerRows,
} from './credit-entries';
import {
  adjustmentView,
  buildLedger,
  filterLedger,
  kindLabel,
  monthEndOf,
  ratesFor,
} from './credit-ledger';
import { appliedSettlements } from './credit-settlement';
import { draftCalc, loadRun, requireDraft, requireEmployed } from './payroll';
import { calcRun, parseSnapshot } from './payroll-calc';
import type { Ctx } from './ports';

const PAGE = 50;

const actor = (ctx: Ctx): string => ctx.user?.id ?? fail('UNAUTHENTICATED');

async function userNames(ctx: Ctx, ids: readonly string[]): Promise<Map<string, string>> {
  const rows = await ctx.db.all<{ id: string; name: string }>(
    'SELECT id, name FROM users WHERE org_id = ?org AND id IN (SELECT value FROM json_each(?))',
    JSON.stringify([...new Set(ids)]),
  );
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** The person must be a member of this org (a staff profile), else 404. */
async function requirePerson(ctx: Ctx, userId: string): Promise<{ name: string }> {
  const p = await ctx.db.first<{ name: string }>(
    `SELECT u.name FROM users u JOIN staff_profiles p ON p.user_id = u.id
      WHERE u.org_id = ?org AND u.id = ?`,
    userId,
  );
  return p ?? fail('NOT_FOUND', 'That person was not found.');
}

function ledgerNames(rows: LedgerRows): string[] {
  const ids = new Set<string>();
  for (const e of rows.entries) if (e.confirmed_by) ids.add(e.confirmed_by);
  for (const a of rows.adjustments) {
    ids.add(a.created_by);
    if (a.voided_by) ids.add(a.voided_by);
  }
  for (const s of rows.settlements) ids.add(s.decided_by);
  return [...ids];
}

const settlementView = (r: CreditSettlementRow): CreditSettlement => ({
  id: r.id,
  userId: r.user_id,
  payrollRunId: r.payroll_run_id,
  month: r.month,
  balanceMin: r.balance_min,
  settleMin: r.settle_min,
  appliedMin: r.applied_min,
  amountPaise: r.amount_paise,
  rate: json<MinuteRate>(r.rate_json, { rDay: { num: 0, den: 1 }, sStd: 540 }),
  warnings: json(r.warnings_json, []),
  status: r.status,
  decidedBy: r.decided_by,
  decidedAt: r.decided_at,
  note: r.note,
});

// ---- Overview and ledger -------------------------------------------------------------------------

export async function creditsOverview(
  ctx: Ctx,
  query: { asOf?: string | undefined },
): Promise<CreditsOverview> {
  const { settings } = await loadOrg(ctx);
  const today = istDate(ctx.now());
  const asOf = query.asOf ?? today;
  const people = await ctx.db.all<{ id: string; name: string }>(
    `SELECT u.id, u.name FROM users u JOIN staff_profiles p ON p.user_id = u.id
      WHERE u.org_id = ?org AND u.role = 'staff' AND u.status = 'active' ORDER BY u.name, u.id`,
  );
  const ids = people.map((p) => p.id);
  const [rows, rates, pending] = await Promise.all([
    loadLedgerRows(ctx, ids),
    ratesFor(ctx, ids, asOf.slice(0, 7), settings),
    ctx.db.all<{ user_id: string; n: number }>(
      `SELECT user_id, COUNT(*) AS n FROM away_intervals WHERE org_id = ?org AND state = 'pending'
        GROUP BY user_id`,
    ),
  ]);
  const waiting = new Map(pending.map((r) => [r.user_id, r.n]));
  const staff = people.map((p) => {
    const r = rows.get(p.id) as LedgerRows;
    const balanceMin = balanceOf(r, asOf);
    const rate = rates.get(p.id);
    const last = [...r.settlements].filter((s) => s.status === 'applied').pop();
    return {
      userId: p.id,
      name: p.name,
      balanceMin,
      estimatePaise: rate ? creditValue(balanceMin, rate) : 0,
      ...(last
        ? {
            lastSettlement: {
              month: last.month,
              appliedMin: last.applied_min,
              amountPaise: last.amount_paise,
            },
          }
        : {}),
      awayPending: waiting.get(p.id) ?? 0,
    };
  });
  staff.sort((a, b) => a.balanceMin - b.balanceMin || a.name.localeCompare(b.name));
  return { enabled: settings.timeCredits.enabled, staff, asOf };
}

export async function creditLedger(
  ctx: Ctx,
  userId: string,
  query: {
    from?: string | undefined;
    to?: string | undefined;
    kind?: Parameters<typeof filterLedger>[1]['kind'];
    unsettled?: boolean | undefined;
    cursor?: string | undefined;
  },
): Promise<CreditLedger> {
  await requirePerson(ctx, userId);
  const settings = await loadSettings(ctx);
  const today = istDate(ctx.now());
  const rows = (await loadLedgerRows(ctx, [userId])).get(userId) as LedgerRows;
  const names = await userNames(ctx, ledgerNames(rows));
  const all = buildLedger(rows, names);
  const settled = rows.settlements.filter((s) => s.status === 'applied');
  const lastSettledEnd =
    settled.length > 0 ? monthEndOf(settled[settled.length - 1]?.month ?? '') : null;
  const filtered = filterLedger(all, query, lastSettledEnd).reverse();
  const offset = query.cursor ? Math.max(0, Number.parseInt(query.cursor, 10) || 0) : 0;
  const items = filtered.slice(offset, offset + PAGE);
  const balanceMin = balanceOf(rows, today);
  const rate = (await ratesFor(ctx, [userId], today.slice(0, 7), settings)).get(userId);
  return {
    items,
    nextCursor: offset + PAGE < filtered.length ? String(offset + PAGE) : null,
    balanceMin,
    estimatePaise: rate ? creditValue(balanceMin, rate) : 0,
  };
}

// ---- Adjustments ---------------------------------------------------------------------------------

async function loadAdjustment(ctx: Ctx, id: string): Promise<CreditAdjustmentRow> {
  const row = await ctx.db.first<CreditAdjustmentRow>(
    'SELECT * FROM credit_adjustments WHERE org_id = ?org AND id = ?',
    id,
  );
  return row ?? fail('NOT_FOUND', 'That adjustment was not found.');
}

export async function createAdjustment(
  ctx: Ctx,
  userId: string,
  body: CreditAdjustmentCreate,
): Promise<CreditAdjustment> {
  await requirePerson(ctx, userId);
  if (body.workDate > istDate(ctx.now())) {
    fail('VALIDATION', 'Adjust a day that has already happened.', { field: 'workDate' });
  }
  const now = ctx.now();
  const row: CreditAdjustmentRow = {
    id: ulid(now),
    user_id: userId,
    work_date: body.workDate,
    kind: body.kind,
    delta_min: body.deltaMin,
    reason: body.reason,
    status: 'active',
    created_by: actor(ctx),
    created_at: now,
    voided_by: null,
    voided_at: null,
    void_reason: null,
  };
  const { id: _id, ...cols } = row;
  await ctx.db.batch([
    ctx.db.insert('credit_adjustments', { id: row.id, ...cols }),
    ctx.services.audit.stmt(ctx, {
      category: 'change',
      action: 'credits.adjust',
      entity: 'credit_adjustment',
      entityId: row.id,
      before: null,
      after: { userId, workDate: body.workDate, kind: body.kind, deltaMin: body.deltaMin },
      reason: body.reason,
    }),
  ]);
  return adjustmentView(row);
}

export async function patchAdjustment(
  ctx: Ctx,
  id: string,
  body: CreditAdjustmentPatch,
): Promise<CreditAdjustment> {
  const old = await loadAdjustment(ctx, id);
  if (old.status === 'void') fail('CONFLICT', 'That adjustment was already voided.');
  const now = ctx.now();
  if (body.deltaMin === undefined || body.deltaMin === old.delta_min) {
    // Only the reason changes: edited in place, the old text stays in the audit log.
    await ctx.db.batch([
      ctx.db.update('credit_adjustments', { reason: body.reason }, 'id = ?', id),
      ctx.services.audit.stmt(ctx, {
        category: 'change',
        action: 'credits.adjust',
        entity: 'credit_adjustment',
        entityId: id,
        before: { deltaMin: old.delta_min, reason: old.reason },
        after: { deltaMin: old.delta_min, reason: body.reason },
        reason: body.reason,
      }),
    ]);
    return adjustmentView({ ...old, reason: body.reason });
  }
  // A new amount: the old row is voided and a new one takes its place, so the ledger history keeps
  // the original adjustment next to the change.
  const next: CreditAdjustmentRow = {
    ...old,
    id: ulid(now),
    delta_min: body.deltaMin,
    reason: body.reason,
    status: 'active',
    created_by: actor(ctx),
    created_at: now,
    voided_by: null,
    voided_at: null,
    void_reason: null,
  };
  const { id: _id, ...cols } = next;
  await ctx.db.batch([
    ctx.db.update(
      'credit_adjustments',
      { status: 'void', voided_by: actor(ctx), voided_at: now, void_reason: 'Changed' },
      'id = ?',
      id,
    ),
    ctx.db.insert('credit_adjustments', { id: next.id, ...cols }),
    ctx.services.audit.stmt(ctx, {
      category: 'change',
      action: 'credits.adjust',
      entity: 'credit_adjustment',
      entityId: next.id,
      before: { id, deltaMin: old.delta_min, reason: old.reason },
      after: { id: next.id, deltaMin: body.deltaMin, reason: body.reason },
      reason: body.reason,
    }),
  ]);
  return adjustmentView(next);
}

export async function voidAdjustment(
  ctx: Ctx,
  id: string,
  body: { reason: string },
): Promise<CreditAdjustment> {
  const old = await loadAdjustment(ctx, id);
  if (old.status === 'void') fail('ALREADY_DECIDED');
  const now = ctx.now();
  const next: CreditAdjustmentRow = {
    ...old,
    status: 'void',
    voided_by: actor(ctx),
    voided_at: now,
    void_reason: body.reason,
  };
  await ctx.db.batch([
    ctx.db.update(
      'credit_adjustments',
      { status: 'void', voided_by: next.voided_by, voided_at: now, void_reason: body.reason },
      'id = ?',
      id,
    ),
    ctx.services.audit.stmt(ctx, {
      category: 'change',
      action: 'credits.adjust.void',
      entity: 'credit_adjustment',
      entityId: id,
      before: { status: 'active', deltaMin: old.delta_min, reason: old.reason },
      after: { status: 'void' },
      reason: body.reason,
    }),
  ]);
  return adjustmentView(next);
}

// ---- Settle credits step -------------------------------------------------------------------------

/** `GET /owner/payroll-runs/:id/credits`: people with a balance on the month end (PRD 4.19.3). */
export async function settleView(ctx: Ctx, runId: string): Promise<CreditsSettleView> {
  const run = await loadRun(ctx, runId);
  if (run.status === 'draft') {
    const calc = await draftCalc(ctx, run);
    const rows = calc.people
      .filter((p) => p.credit.balanceMin !== 0 || p.credit.settleMin !== 0)
      .map((p) => {
        const c = p.credit;
        const applied = c.applied ?? { appliedMin: 0, amountPaise: 0, stayMin: c.balanceMin };
        return {
          userId: p.profile.user_id,
          name: p.profile.name,
          balanceMin: c.balanceMin,
          suggestedMin: c.balanceMin,
          settleMin: c.settleMin,
          appliedMin: applied.appliedMin,
          amountPaise: applied.amountPaise,
          stayMin: applied.stayMin,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    return { rows };
  }
  const applied = await appliedSettlements(ctx, run.id);
  const names = await userNames(ctx, [...applied.keys()]);
  const rows = [...applied.values()].map((s) => ({
    userId: s.user_id,
    name: names.get(s.user_id) ?? '',
    balanceMin: s.balance_min,
    suggestedMin: s.balance_min,
    settleMin: s.settle_min,
    appliedMin: s.applied_min,
    amountPaise: s.amount_paise,
    stayMin: s.balance_min - s.applied_min,
  }));
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return { rows };
}

/**
 * `PUT /owner/payroll-runs/:id/credits/:userId`: save the person's settlement (0 removes it) and
 * recompute their payslip inside the run, until Finalise (PRD 7.17.5, 4.19.5).
 */
export async function setSettlement(
  ctx: Ctx,
  runId: string,
  userId: string,
  body: { settleMin: number },
): Promise<CreditSettleResult> {
  const run = await loadRun(ctx, runId);
  requireDraft(run);
  await requireEmployed(ctx, run, userId);
  const s = body.settleMin;
  const rows = (await loadLedgerRows(ctx, [userId])).get(userId) as LedgerRows;
  const balance = balanceOf(rows, monthEndOf(run.month));
  if (s !== 0 && (Math.sign(s) !== Math.sign(balance) || Math.abs(s) > Math.abs(balance))) {
    fail(
      'RULE_VIOLATION',
      balance === 0
        ? 'There is no balance to settle.'
        : 'Settle between 0 and the balance, on the same side.',
      { field: 'settleMin', balanceMin: balance },
    );
  }
  const snap = parseSnapshot(run.settings_snapshot_json);
  const calc = await calcRun(ctx, {
    month: run.month,
    settings: snap.settings,
    overrides: snap.overrides ?? [],
    runId: run.id,
    userId,
    settlements: new Map([[userId, s]]),
  });
  const p = calc.people.find((x) => x.profile.user_id === userId);
  if (!p) fail('NOT_FOUND', 'That person is not in this payroll.');
  const applied = p.credit.applied ?? { appliedMin: 0, amountPaise: 0, stayMin: balance };

  const existing = await ctx.db.first<CreditSettlementRow>(
    `SELECT * FROM credit_settlements WHERE org_id = ?org AND payroll_run_id = ? AND user_id = ?
        AND status = 'draft'`,
    run.id,
    userId,
  );
  const now = ctx.now();
  const row: CreditSettlementRow = {
    id: existing?.id ?? ulid(now),
    user_id: userId,
    payroll_run_id: run.id,
    month: run.month,
    balance_min: balance,
    settle_min: s,
    applied_min: applied.appliedMin,
    amount_paise: applied.amountPaise,
    rate_json: JSON.stringify(p.credit.rate),
    warnings_json: JSON.stringify(p.result.warnings),
    // Zero removes the settlement: the row stays as `void` so the history is kept.
    status: s === 0 ? 'void' : 'draft',
    decided_by: actor(ctx),
    decided_at: now,
    note: existing?.note ?? null,
  };
  const { id: _id, ...cols } = row;
  const write = existing
    ? ctx.db.update('credit_settlements', cols, 'id = ?', row.id)
    : ctx.db.insert('credit_settlements', { id: row.id, ...cols });
  await ctx.db.batch([
    write,
    ctx.services.audit.stmt(ctx, {
      category: 'change',
      action: 'credits.settle',
      entity: 'credit_settlement',
      entityId: row.id,
      before: existing
        ? { settleMin: existing.settle_min, appliedMin: existing.applied_min }
        : null,
      after: {
        runId: run.id,
        month: run.month,
        userId,
        balanceMin: balance,
        settleMin: s,
        appliedMin: applied.appliedMin,
        amountPaise: applied.amountPaise,
        status: row.status,
      },
    }),
  ]);
  return {
    settlement: settlementView(row),
    lines: p.result.lines,
    warnings: p.result.warnings,
  };
}

// ---- CSV export -----------------------------------------------------------------------------------

const dmy = (date: string) => `${date.slice(8, 10)}-${date.slice(5, 7)}-${date.slice(0, 4)}`;

/**
 * The `credits_ledger` export (PRD 4.19.2): every ledger row of the month for the chosen people (all
 * active staff when none are named), with the running balance. Owner only.
 */
export async function creditsLedgerTable(
  ctx: Ctx,
  p: { month: string; userIds?: string[] | undefined },
): Promise<{ header: string[]; rows: (string | number | null)[][] }> {
  const people = await ctx.db.all<{ id: string; name: string }>(
    `SELECT u.id, u.name FROM users u JOIN staff_profiles sp ON sp.user_id = u.id
      WHERE u.org_id = ?org AND u.role = 'staff' ${
        p.userIds ? 'AND u.id IN (SELECT value FROM json_each(?))' : "AND u.status = 'active'"
      } ORDER BY u.name, u.id`,
    ...(p.userIds ? [JSON.stringify(p.userIds)] : []),
  );
  const rows = await loadLedgerRows(
    ctx,
    people.map((x) => x.id),
  );
  const out: (string | number | null)[][] = [];
  for (const person of people) {
    const r = rows.get(person.id) as LedgerRows;
    const names = await userNames(ctx, ledgerNames(r));
    for (const row of buildLedger(r, names)) {
      if (row.date.slice(0, 7) !== p.month) continue;
      out.push([
        dmy(row.date),
        person.name,
        kindLabel(row.kind),
        row.minutes,
        row.adjustedMin,
        row.runningBalanceMin,
        row.kind === 'settled' ? 'Payroll' : row.source.kind,
        row.confirmedBy?.name ?? (row.kind === 'late' || row.kind === 'early' ? 'automatic' : ''),
      ]);
    }
  }
  return {
    header: [
      'Date',
      'Staff',
      'Kind',
      'Minutes',
      'Adjusted min',
      'Balance after',
      'Source',
      'Confirmed by',
    ],
    rows: out,
  };
}
