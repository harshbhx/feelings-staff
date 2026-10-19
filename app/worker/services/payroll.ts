/**
 * PayrollService (PRD 4.13): draft, blockers, review, adjustments, recompute, finalise, reopen and
 * mark paid. A draft is computed live from attendance (see payroll-calc.ts); finalise freezes one
 * PayslipResult snapshot per person, locks the month's attendance rows, writes the advance
 * recoveries and tells staff, all in one batch with its audit row. Owner: WP-5.
 */
import {
  type AdjustmentCreate,
  type Endpoints,
  istDate,
  type OrgSettings,
  type OutputOf,
  type ParsedInputOf,
  type PayrollPersonLine,
  type PayrollRunSummary,
  type PayrollRunView,
  type PayslipResult,
  type PayslipView,
} from '@fs/contracts';
import { ENGINE_VERSION } from '@fs/engine';
import { randomToken } from '../lib/crypto';
import { fail } from '../lib/errors';
import { loadSettings } from '../lib/settings';
import { ulid } from '../lib/ulid';
import { applyStmts, reopenStmts } from './credit-settlement';
import { dayKey, dayStmts, jsonList, personBrief } from './day';
import { monthName } from './leave';
import {
  type AdjustmentRow,
  calcRun,
  monthEnd,
  monthStart,
  type PersonCalc,
  parseSnapshot,
  type RunCalc,
  type RunRow,
  type RunSnapshot,
} from './payroll-calc';
import {
  buildSnapshot,
  draftPayslipView,
  type PayslipRow,
  payslipView,
  snapshotOf,
} from './payslip';
import { generateRunPdfs } from './payslip-pdf';
import type { Ctx, PayrollService } from './ports';

type OwnerPayslip = OutputOf<Endpoints['ownerPayslipPreview']>;

const PREVIEW_ID = '00000000000000000000000000';

function actor(ctx: Ctx): string {
  return ctx.user?.id ?? fail('UNAUTHENTICATED');
}

// ---- Loading -------------------------------------------------------------------------------------

export async function loadRun(ctx: Ctx, id: string): Promise<RunRow> {
  const run = await ctx.db.first<RunRow>(
    'SELECT * FROM payroll_runs WHERE org_id = ?org AND id = ?',
    id,
  );
  return run ?? fail('NOT_FOUND', 'That payroll run was not found.');
}

async function runPayslips(ctx: Ctx, runId: string): Promise<PayslipRow[]> {
  return ctx.db.all<PayslipRow>(
    'SELECT * FROM payslips WHERE org_id = ?org AND payroll_run_id = ? ORDER BY created_at, id',
    runId,
  );
}

export function requireDraft(run: RunRow): void {
  if (run.status !== 'draft')
    fail('MONTH_LOCKED', 'This payroll is final. Reopen it to change it.');
}

export const draftCalc = (ctx: Ctx, run: RunRow, userId?: string): Promise<RunCalc> => {
  const snap = parseSnapshot(run.settings_snapshot_json);
  return calcRun(ctx, {
    month: run.month,
    settings: snap.settings,
    overrides: snap.overrides ?? [],
    runId: run.id,
    ...(userId ? { userId } : {}),
  });
};

// ---- Views ---------------------------------------------------------------------------------------

function line(p: {
  user: PayrollPersonLine['user'];
  result: PayslipResult;
  payslipId: string | null;
  paid: PayrollPersonLine['paid'];
  pdfStatus: PayrollPersonLine['pdfStatus'];
}): PayrollPersonLine {
  const r = p.result;
  return {
    user: p.user,
    payslipId: p.payslipId,
    salaryType: r.salaryType,
    paidDays: r.counts.paidDays,
    lopDays: r.counts.lopDays,
    lateMin: r.lateBillableMin,
    earlyMin: r.earlyBillableMin,
    otApprovedMin: r.otApprovedMin,
    grossPaise: r.grossPaise,
    deductionsPaise: r.deductionsPaise,
    netPaise: r.netPaise,
    warnings: r.warnings.map((w) => w.message),
    paid: p.paid,
    pdfStatus: p.pdfStatus,
  };
}

function assemble(
  run: Omit<PayrollRunView['run'], 'people' | 'netPaise' | 'paidCount'>,
  lines: PayrollPersonLine[],
  blockers: PayrollRunView['blockers'],
  names: Map<string, string>,
): PayrollRunView {
  const totals = {
    people: lines.length,
    grossPaise: lines.reduce((s, l) => s + l.grossPaise, 0),
    deductionsPaise: lines.reduce((s, l) => s + l.deductionsPaise, 0),
    netPaise: lines.reduce((s, l) => s + l.netPaise, 0),
    paidCount: lines.filter((l) => l.paid !== null).length,
  };
  return {
    run: { ...run, people: totals.people, netPaise: totals.netPaise, paidCount: totals.paidCount },
    blockers,
    totals,
    lines,
    warnings: lines.flatMap((l) =>
      l.warnings.map((w) => `${names.get(l.user.id) ?? l.user.name}: ${w}`),
    ),
  };
}

async function userName(ctx: Ctx, id: string | null): Promise<string | null> {
  if (!id) return null;
  const r = await ctx.db.first<{ name: string }>(
    'SELECT name FROM users WHERE org_id = ?org AND id = ?',
    id,
  );
  return r?.name ?? null;
}

const runMeta = (run: RunRow, finalisedByName: string | null, preview = false) => ({
  id: run.id,
  month: run.month,
  revision: run.revision,
  status: run.status,
  createdAt: run.created_at,
  finalisedAt: run.finalised_at,
  finalisedByName,
  reopenedReason: run.reopened_reason,
  engineVersion: run.engine_version,
  preview,
});

export async function runView(ctx: Ctx, run: RunRow): Promise<PayrollRunView> {
  const finalisedByName = await userName(ctx, run.finalised_by);
  if (run.status === 'draft') {
    const calc = await draftCalc(ctx, run);
    const lines = calc.people.map((p) =>
      line({
        user: personBrief({
          id: p.profile.user_id,
          name: p.profile.name,
          designation: p.profile.designation,
          phone_e164: p.profile.phone_e164,
        }),
        result: p.result,
        payslipId: null,
        paid: null,
        pdfStatus: null,
      }),
    );
    return assemble(runMeta(run, finalisedByName), lines, calc.blockers, new Map());
  }
  const slips = await runPayslips(ctx, run.id);
  const lines = slips.map((row) => {
    const snap = snapshotOf(row);
    return line({
      user: {
        id: snap.person.id,
        name: snap.person.name,
        designation: snap.person.designation,
        phone: snap.person.phone,
      },
      result: snap.result,
      payslipId: row.id,
      paid: row.paid_on
        ? { on: row.paid_on, mode: row.pay_mode ?? 'cash', ref: row.pay_ref }
        : null,
      pdfStatus: row.pdf_status,
    });
  });
  return assemble(runMeta(run, finalisedByName), lines, [], new Map());
}

/** "Payroll so far": the month up to today, nothing stored. */
export async function previewView(ctx: Ctx, month: string): Promise<PayrollRunView> {
  const settings = await loadSettings(ctx);
  const today = istDate(ctx.now());
  const calc = await calcRun(ctx, {
    month,
    settings,
    overrides: [],
    runId: null,
    ...(today < monthEnd(month) ? { until: today } : {}),
  });
  const lines = calc.people.map((p) =>
    line({
      user: personBrief({
        id: p.profile.user_id,
        name: p.profile.name,
        designation: p.profile.designation,
        phone_e164: p.profile.phone_e164,
      }),
      result: p.result,
      payslipId: null,
      paid: null,
      pdfStatus: null,
    }),
  );
  const fake: RunRow = {
    id: PREVIEW_ID,
    month,
    revision: 1,
    status: 'draft',
    settings_snapshot_json: '{}',
    engine_version: ENGINE_VERSION,
    created_by: actor(ctx),
    created_at: ctx.now(),
    opened_at: null,
    finalised_by: null,
    finalised_at: null,
    reopened_reason: null,
  };
  return assemble(runMeta(fake, null, true), lines, calc.blockers, new Map());
}

export async function listRuns(ctx: Ctx): Promise<PayrollRunSummary[]> {
  const runs = await ctx.db.all<RunRow>(
    'SELECT * FROM payroll_runs WHERE org_id = ?org ORDER BY month DESC, revision DESC',
  );
  const out: PayrollRunSummary[] = [];
  for (const run of runs) {
    const v = await runView(ctx, run);
    out.push({
      id: run.id,
      month: run.month,
      revision: run.revision,
      status: run.status,
      people: v.totals.people,
      netPaise: v.totals.netPaise,
      paidCount: v.totals.paidCount,
      createdAt: run.created_at,
      finalisedAt: run.finalised_at,
    });
  }
  return out;
}

// ---- One person ----------------------------------------------------------------------------------

async function personExtras(
  ctx: Ctx,
  run: RunRow,
  userId: string,
  result: PayslipResult,
  phone: string | null,
  adj: AdjustmentRow[],
) {
  const advances = await ctx.db.all<{ id: string; amount_paise: number; recovered: number }>(
    `SELECT a.id, a.amount_paise,
            COALESCE((SELECT SUM(recovered_paise) FROM advance_recoveries r WHERE r.advance_id = a.id AND r.month <= ?), 0) AS recovered
       FROM advances a WHERE a.org_id = ?org AND a.user_id = ? AND a.id IN (SELECT value FROM json_each(?))`,
    run.month,
    userId,
    jsonList(result.advanceRecoveries.map((x) => x.advanceId)),
  );
  const owed = new Map(advances.map((a) => [a.id, a.amount_paise - a.recovered]));
  return {
    adjustments: adj.map((a) => ({
      id: a.id,
      kind: a.kind,
      amountPaise: a.amount_paise,
      note: a.note,
      createdAt: a.created_at,
    })),
    advances: result.advanceRecoveries.map((a) => ({
      advanceId: a.advanceId,
      duePaise: a.duePaise,
      recoverPaise: a.recoveredPaise,
      // After a finalised month the sum already includes it; in a draft take this month off by hand.
      balancePaise: Math.max(
        0,
        (owed.get(a.advanceId) ?? 0) - (run.status === 'draft' ? a.recoveredPaise : 0),
      ),
    })),
    phone,
  };
}

export async function personView(ctx: Ctx, run: RunRow, userId: string): Promise<OwnerPayslip> {
  let base: PayslipView;
  let phone: string | null;
  let adj: AdjustmentRow[];
  if (run.status === 'draft') {
    const calc = await draftCalc(ctx, run, userId);
    const p = calc.people.find((x) => x.profile.user_id === userId);
    if (!p) return fail('NOT_FOUND', 'That person is not in this payroll.');
    base = draftPayslipView(await buildSnapshot(ctx, p), run);
    phone = p.profile.phone_e164;
    adj = p.adjustments;
  } else {
    const row = await ctx.db.first<PayslipRow>(
      'SELECT * FROM payslips WHERE org_id = ?org AND payroll_run_id = ? AND user_id = ?',
      run.id,
      userId,
    );
    if (!row) return fail('NOT_FOUND', 'That person is not in this payroll.');
    base = payslipView(ctx, row, run);
    phone = snapshotOf(row).person.phone;
    adj = await ctx.db.all<AdjustmentRow>(
      'SELECT * FROM adjustments WHERE org_id = ?org AND payroll_run_id = ? AND user_id = ? ORDER BY created_at, id',
      run.id,
      userId,
    );
  }
  const extras = await personExtras(ctx, run, userId, base.result, phone, adj);
  const share = base.verifyUrl ? `Your ${monthName(run.month)} salary slip: ${base.verifyUrl}` : '';
  const digits = extras.phone?.replace(/\D/g, '') ?? '';
  return {
    ...base,
    adjustments: extras.adjustments,
    advances: extras.advances,
    shareText: share,
    waLink: share && digits ? `https://wa.me/${digits}?text=${encodeURIComponent(share)}` : null,
  };
}

// ---- Draft ---------------------------------------------------------------------------------------

export async function draftForMonth(ctx: Ctx, month: string): Promise<PayrollRunView> {
  const today = istDate(ctx.now());
  if (monthEnd(month) >= today)
    fail('RULE_VIOLATION', `${monthName(month)} is not over yet. Payroll starts on the 1st.`);
  const existing = await ctx.db.first<{ id: string }>(
    'SELECT id FROM payroll_runs WHERE org_id = ?org AND month = ? LIMIT 1',
    month,
  );
  if (existing)
    fail('DUPLICATE', `There is already a payroll for ${monthName(month)}.`, {
      runId: existing.id,
    });
  const settings = await loadSettings(ctx);
  const id = ulid(ctx.now());
  const snapshot: RunSnapshot = { settings, overrides: [] };
  await ctx.db.batch([
    ctx.db.insert('payroll_runs', {
      id,
      month,
      revision: 1,
      status: 'draft',
      settings_snapshot_json: JSON.stringify(snapshot),
      engine_version: ENGINE_VERSION,
      created_by: ctx.user?.id ?? 'system',
      created_at: ctx.now(),
    }),
    ctx.services.audit.stmt(ctx, {
      category: 'change',
      action: 'payroll.draft',
      entity: 'payroll_run',
      entityId: id,
      after: { month, revision: 1 },
    }),
  ]);
  return runView(ctx, await loadRun(ctx, id));
}

export async function recomputeRun(ctx: Ctx, runId: string): Promise<PayrollRunView> {
  const run = await loadRun(ctx, runId);
  requireDraft(run);
  const snap = parseSnapshot(run.settings_snapshot_json);
  const next: RunSnapshot = { ...snap, settings: await loadSettings(ctx) };
  await ctx.db.batch([
    ctx.db.update(
      'payroll_runs',
      { settings_snapshot_json: JSON.stringify(next), engine_version: ENGINE_VERSION },
      'id = ?',
      run.id,
    ),
    ctx.services.audit.stmt(ctx, {
      category: 'change',
      action: 'payroll.recompute',
      entity: 'payroll_run',
      entityId: run.id,
      before: { engineVersion: run.engine_version },
      after: { engineVersion: ENGINE_VERSION },
    }),
  ]);
  return runView(ctx, await loadRun(ctx, runId));
}

// ---- Adjustments and advance recovery -----------------------------------------------------------

export async function requireEmployed(ctx: Ctx, run: RunRow, userId: string): Promise<void> {
  const p = await ctx.db.first<{ id: string }>(
    `SELECT user_id AS id FROM staff_profiles
      WHERE org_id = ?org AND user_id = ? AND join_date <= ? AND (exit_date IS NULL OR exit_date >= ?)`,
    userId,
    monthEnd(run.month),
    monthStart(run.month),
  );
  if (!p) fail('VALIDATION', 'That person is not in this payroll.', { field: 'userId' });
}

export async function addAdjustment(
  ctx: Ctx,
  runId: string,
  body: AdjustmentCreate,
): Promise<OwnerPayslip> {
  const run = await loadRun(ctx, runId);
  requireDraft(run);
  await requireEmployed(ctx, run, body.userId);
  if (body.kind === 'damage' && !body.showCauseRef) {
    fail('VALIDATION', 'A deduction for damage or loss needs the show-cause reference.', {
      issues: [{ path: 'showCauseRef', message: 'Required for damage', code: 'custom' }],
    });
  }
  const id = ulid(ctx.now());
  const row = {
    id,
    payroll_run_id: run.id,
    user_id: body.userId,
    kind: body.kind,
    amount_paise: body.amountPaise,
    note: body.note,
    show_cause_ref: body.showCauseRef ?? null,
    created_by: actor(ctx),
    created_at: ctx.now(),
  };
  await ctx.db.batch([
    ctx.db.insert('adjustments', row),
    ctx.services.audit.stmt(ctx, {
      category: 'change',
      action: 'payroll.adjustment.add',
      entity: 'adjustment',
      entityId: id,
      after: row,
    }),
  ]);
  return personView(ctx, run, body.userId);
}

export async function deleteAdjustment(
  ctx: Ctx,
  runId: string,
  adjId: string,
): Promise<OwnerPayslip> {
  const run = await loadRun(ctx, runId);
  requireDraft(run);
  const adj = await ctx.db.first<AdjustmentRow>(
    'SELECT * FROM adjustments WHERE org_id = ?org AND id = ? AND payroll_run_id = ?',
    adjId,
    run.id,
  );
  if (!adj) fail('NOT_FOUND', 'That adjustment was not found.');
  await ctx.db.batch([
    ctx.db.stmt('DELETE FROM adjustments WHERE org_id = ?org AND id = ?', adjId),
    ctx.services.audit.stmt(ctx, {
      category: 'change',
      action: 'payroll.adjustment.delete',
      entity: 'adjustment',
      entityId: adjId,
      before: adj,
    }),
  ]);
  return personView(ctx, run, adj.user_id);
}

export async function patchRecovery(
  ctx: Ctx,
  runId: string,
  body: ParsedInputOf<Endpoints['ownerAdvanceRecovery']>['body'],
): Promise<OwnerPayslip> {
  const run = await loadRun(ctx, runId);
  requireDraft(run);
  const view = await personView(ctx, run, body.userId);
  const due = view.advances.find((a) => a.advanceId === body.advanceId);
  if (!due) fail('NOT_FOUND', 'That advance is not being recovered this month.');
  const snap = parseSnapshot(run.settings_snapshot_json);
  const overrides = (snap.overrides ?? []).filter(
    (o) => !(o.userId === body.userId && o.advanceId === body.advanceId),
  );
  overrides.push({
    userId: body.userId,
    advanceId: body.advanceId,
    recoverPaise: Math.min(body.recoverPaise, due.duePaise),
  });
  await ctx.db.batch([
    ctx.db.update(
      'payroll_runs',
      { settings_snapshot_json: JSON.stringify({ ...snap, overrides }) },
      'id = ?',
      run.id,
    ),
    ctx.services.audit.stmt(ctx, {
      category: 'change',
      action: 'payroll.advance_recovery',
      entity: 'payroll_run',
      entityId: run.id,
      after: { userId: body.userId, advanceId: body.advanceId, recoverPaise: body.recoverPaise },
    }),
  ]);
  return personView(ctx, await loadRun(ctx, runId), body.userId);
}

// ---- Finalise ------------------------------------------------------------------------------------

const DAY_FIELDS = [
  'status',
  'worked_min',
  'late_billable_min',
  'early_billable_min',
  'undertime_min',
  'ot_approved_min',
  'offday_credit',
] as const;

export async function finaliseRun(
  ctx: Ctx,
  runId: string,
  acceptDefaults: boolean,
): Promise<PayrollRunView> {
  const run = await loadRun(ctx, runId);
  requireDraft(run);
  if (monthEnd(run.month) >= istDate(ctx.now()))
    fail('RULE_VIOLATION', `${monthName(run.month)} is not over yet.`);
  const calc = await draftCalc(ctx, run);
  if (calc.blockers.length > 0 && !acceptDefaults) {
    fail('RULE_VIOLATION', 'Some items are still open. Resolve them or finalise anyway.', {
      blockers: calc.blockers,
    });
  }
  if (calc.people.length === 0) fail('VALIDATION', 'There is no one to pay for this month.');
  const snap = parseSnapshot(run.settings_snapshot_json);
  const now = ctx.now();
  const stmts: D1PreparedStatement[] = [];

  // Revision 2+: payslips already paid keep their paid record; "settle next month" posts the difference.
  const previous =
    run.revision > 1
      ? await ctx.db.all<PayslipRow>(
          `SELECT p.* FROM payslips p JOIN payroll_runs r ON r.id = p.payroll_run_id
            WHERE p.org_id = ?org AND r.month = ? AND r.revision = ?`,
          run.month,
          run.revision - 1,
        )
      : [];
  const paidBefore = new Map(previous.filter((p) => p.paid_on).map((p) => [p.user_id, p]));
  const settle: NonNullable<RunSnapshot['settle']> = [];

  const people: { p: PersonCalc; id: string }[] = [];
  for (const p of calc.people) {
    const id = ulid(now);
    people.push({ p, id });
    const snapshot = await buildSnapshot(ctx, p);
    const r = p.result;
    const paid = paidBefore.get(p.profile.user_id);
    if (paid && snap.settleMode === 'next_month' && r.netPaise !== paid.net_paise) {
      settle.push({ userId: p.profile.user_id, diffPaise: r.netPaise - paid.net_paise });
    }
    stmts.push(
      ctx.db.insert('payslips', {
        id,
        payroll_run_id: run.id,
        user_id: p.profile.user_id,
        snapshot_json: JSON.stringify(snapshot),
        gross_paise: r.grossPaise,
        deductions_paise: r.deductionsPaise,
        net_paise: r.netPaise,
        rounding_paise: r.roundingPaise,
        pdf_status: 'pending',
        verify_token: randomToken(16),
        paid_on: paid?.paid_on ?? null,
        pay_mode: paid?.pay_mode ?? null,
        pay_ref: paid?.pay_ref ?? null,
        paid_marked_by: paid?.paid_marked_by ?? null,
        created_at: now,
      }),
    );
    for (const a of r.advanceRecoveries) {
      stmts.push(
        ctx.db.insert('advance_recoveries', {
          id: ulid(now),
          advance_id: a.advanceId,
          user_id: p.profile.user_id,
          month: run.month,
          payroll_run_id: run.id,
          scheduled_paise: a.duePaise,
          recovered_paise: a.recoveredPaise,
          carried_paise: a.carriedPaise,
          created_at: now,
        }),
        ctx.db.update(
          'advances',
          { status: 'closed' },
          `id = ? AND status = 'active' AND amount_paise <= (SELECT COALESCE(SUM(recovered_paise), 0) FROM advance_recoveries WHERE advance_id = advances.id)`,
          a.advanceId,
        ),
      );
    }
    // Freeze the day rows the payslip was computed from (missing or stale ones are written first).
    for (const c of p.days) {
      const stored = calc.data.stored.get(dayKey(c.userId, c.date));
      const r2 = c.result;
      const fresh = {
        status: r2.status,
        worked_min: r2.workedMin,
        late_billable_min: r2.lateBillableMin,
        early_billable_min: r2.earlyBillableMin,
        undertime_min: r2.undertimeMin,
        ot_approved_min: c.otApprovedMin,
        offday_credit: r2.offdayCredit,
      };
      if (!stored || DAY_FIELDS.some((f) => stored[f] !== fresh[f])) {
        stmts.push(...(await dayStmts(ctx, calc.data, c)));
      }
    }
  }
  // The Time credits settlements become final with the payslips (PRD 7.17.5).
  stmts.push(...(await applyStmts(ctx, run, calc.people, now)));
  stmts.push(
    ctx.db.stmt(
      `UPDATE attendance_days SET locked = 1, payroll_run_id = ?
        WHERE org_id = ?org AND work_date BETWEEN ? AND ? AND user_id IN (SELECT value FROM json_each(?))`,
      run.id,
      monthStart(run.month),
      monthEnd(run.month),
      jsonList(people.map((x) => x.p.profile.user_id)),
    ),
    ctx.db.update(
      'payroll_runs',
      {
        status: 'finalised',
        finalised_by: actor(ctx),
        finalised_at: now,
        engine_version: ENGINE_VERSION,
        ...(settle.length > 0
          ? { settings_snapshot_json: JSON.stringify({ ...snap, settle }) }
          : {}),
      },
      'id = ?',
      run.id,
    ),
    ctx.services.audit.stmt(ctx, {
      category: 'change',
      action: 'payroll.finalise',
      entity: 'payroll_run',
      entityId: run.id,
      after: {
        month: run.month,
        revision: run.revision,
        people: people.length,
        netPaise: calc.people.reduce((s, x) => s + x.result.netPaise, 0),
        acceptedBlockers: calc.blockers.map((b) => ({ kind: b.kind, count: b.count })),
      },
    }),
  );
  await ctx.db.batch(stmts);

  if (snap.settings.pay.showPayslipsToStaff) {
    await ctx.services.notifier.emit(ctx, {
      type: 'payslip_ready',
      orgId: ctx.orgId ?? '',
      at: now,
      userIds: people.map((x) => x.p.profile.user_id),
      runId: run.id,
      month: run.month,
    });
  }
  ctx.waitUntil(generateRunPdfs(ctx, run.id));
  return runView(ctx, await loadRun(ctx, run.id));
}

// ---- Reopen --------------------------------------------------------------------------------------

export async function reopenRun(
  ctx: Ctx,
  runId: string,
  body: ParsedInputOf<Endpoints['ownerPayrollReopen']>['body'],
): Promise<PayrollRunView> {
  const run = await loadRun(ctx, runId);
  if (run.status !== 'finalised') fail('CONFLICT', 'Only a final payroll can be reopened.');
  const now = ctx.now();
  const id = ulid(now);
  const snap = parseSnapshot(run.settings_snapshot_json);
  const next: RunSnapshot = {
    settings: snap.settings as OrgSettings,
    overrides: snap.overrides ?? [],
    settleMode: body.settleMode,
  };
  const adjustments = await ctx.db.all<AdjustmentRow>(
    'SELECT * FROM adjustments WHERE org_id = ?org AND payroll_run_id = ? ORDER BY created_at, id',
    run.id,
  );
  const stmts = [
    ctx.db.update(
      'payroll_runs',
      { status: 'superseded', reopened_reason: body.reason },
      'id = ?',
      run.id,
    ),
    ctx.db.insert('payroll_runs', {
      id,
      month: run.month,
      revision: run.revision + 1,
      status: 'draft',
      settings_snapshot_json: JSON.stringify(next),
      engine_version: ENGINE_VERSION,
      created_by: actor(ctx),
      created_at: now,
      reopened_reason: body.reason,
    }),
    ctx.db.stmt(
      `UPDATE advances SET status = 'active' WHERE org_id = ?org AND status = 'closed'
         AND id IN (SELECT advance_id FROM advance_recoveries WHERE payroll_run_id = ?)`,
      run.id,
    ),
    ctx.db.stmt(
      'DELETE FROM advance_recoveries WHERE org_id = ?org AND payroll_run_id = ?',
      run.id,
    ),
    ctx.db.stmt(
      'UPDATE attendance_days SET locked = 0, payroll_run_id = NULL WHERE org_id = ?org AND payroll_run_id = ?',
      run.id,
    ),
    // The replaced payslips are rendered again with the "Replaced by revision N" watermark.
    ctx.db.stmt(
      "UPDATE payslips SET pdf_status = 'pending' WHERE org_id = ?org AND payroll_run_id = ?",
      run.id,
    ),
    ...(await reopenStmts(ctx, run, id, now)),
    ...adjustments.map((a) =>
      ctx.db.insert('adjustments', {
        id: ulid(now),
        payroll_run_id: id,
        user_id: a.user_id,
        kind: a.kind,
        amount_paise: a.amount_paise,
        note: a.note,
        show_cause_ref: a.show_cause_ref,
        created_by: a.created_by,
        created_at: a.created_at,
      }),
    ),
    ctx.services.audit.stmt(ctx, {
      category: 'change',
      action: 'payroll.reopen',
      entity: 'payroll_run',
      entityId: run.id,
      before: { status: 'finalised', revision: run.revision },
      after: { newRunId: id, revision: run.revision + 1, settleMode: body.settleMode },
      reason: body.reason,
    }),
  ];
  await ctx.db.batch(stmts);
  ctx.waitUntil(generateRunPdfs(ctx, run.id));
  return runView(ctx, await loadRun(ctx, id));
}

// ---- Mark paid -----------------------------------------------------------------------------------

type MarkBody = ParsedInputOf<Endpoints['ownerPayslipMarkPaid']>['body'];

function checkPaidOn(ctx: Ctx, body: MarkBody): void {
  if (body.paidOn > istDate(ctx.now()))
    fail('VALIDATION', 'The pay date cannot be in the future.', { field: 'paidOn' });
}

const markStmts = (ctx: Ctx, row: PayslipRow, run: RunRow, body: MarkBody) => [
  ctx.db.update(
    'payslips',
    {
      paid_on: body.paidOn,
      pay_mode: body.mode,
      pay_ref: body.ref ?? null,
      paid_marked_by: actor(ctx),
    },
    'id = ? AND paid_on IS NULL',
    row.id,
  ),
  ctx.services.audit.stmt(ctx, {
    category: 'change',
    action: 'payroll.mark_paid',
    entity: 'payslip',
    entityId: row.id,
    after: { month: run.month, userId: row.user_id, netPaise: row.net_paise, ...body },
  }),
];

export async function markPaid(ctx: Ctx, payslipId: string, body: MarkBody): Promise<OwnerPayslip> {
  checkPaidOn(ctx, body);
  const row = await ctx.db.first<PayslipRow>(
    'SELECT * FROM payslips WHERE org_id = ?org AND id = ?',
    payslipId,
  );
  if (!row) fail('NOT_FOUND', 'That payslip was not found.');
  const run = await loadRun(ctx, row.payroll_run_id);
  if (run.status !== 'finalised') fail('CONFLICT', 'Only a final payslip can be marked paid.');
  if (row.paid_on) fail('ALREADY_DECIDED', 'This salary is already marked paid.');
  await ctx.db.batch(markStmts(ctx, row, run, body));
  return personView(ctx, run, row.user_id);
}

export async function markAllPaid(
  ctx: Ctx,
  runId: string,
  body: MarkBody,
): Promise<PayrollRunView> {
  checkPaidOn(ctx, body);
  const run = await loadRun(ctx, runId);
  if (run.status !== 'finalised') fail('CONFLICT', 'Only a final payroll can be marked paid.');
  const unpaid = (await runPayslips(ctx, run.id)).filter((r) => !r.paid_on);
  await ctx.db.batch(unpaid.flatMap((r) => markStmts(ctx, r, run, body)));
  return runView(ctx, run);
}

// ---- Port ----------------------------------------------------------------------------------------

export function createPayrollService(): PayrollService {
  return {
    draft: draftForMonth,
    recompute: recomputeRun,
    finalise: finaliseRun,
  };
}
