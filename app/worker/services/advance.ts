/**
 * Advances (PRD 4.10): recorded by the owner or asked for by staff, recovered by payroll within the
 * 50% cap. This file owns the rows, the ledger view and the staff acknowledgement. Owner: WP-5.
 */
import {
  type AdvanceCreate,
  type AdvanceView,
  type Endpoints,
  formatRupees,
  istDate,
  type OutputOf,
  type ParsedInputOf,
  type PersonBrief,
} from '@fs/contracts';
import { fail } from '../lib/errors';
import { ulid } from '../lib/ulid';
import { jsonList, personBrief } from './day';
import { monthName } from './leave';
import type { AdvanceRow } from './payroll-calc';
import { shiftMonth } from './payroll-calc';
import type { Ctx } from './ports';

type Plan = Pick<AdvanceRow, 'plan' | 'instalments_n' | 'first_month'>;

interface RecoveryRow {
  advance_id: string;
  month: string;
  payroll_run_id: string;
  scheduled_paise: number;
  recovered_paise: number;
  carried_paise: number;
}

const rupees = (paise: number) => formatRupees(paise, { whole: true });

function actor(ctx: Ctx): string {
  const id = ctx.user?.id;
  if (!id) fail('UNAUTHENTICATED');
  return id;
}

/** `Recovery: ₹3,000 from October salary.` or `Recovery: 3 monthly instalments from November.` */
export function recoverySummary(amountPaise: number, a: Plan): string {
  if (a.plan === 'full')
    return `Recovery: ${rupees(amountPaise)} from ${monthName(a.first_month)} salary.`;
  return `Recovery: ${a.instalments_n} monthly instalments from ${monthName(a.first_month)}.`;
}

async function briefs(ctx: Ctx, userIds: readonly string[]): Promise<Map<string, PersonBrief>> {
  if (userIds.length === 0) return new Map();
  const rows = await ctx.db.all<{
    id: string;
    name: string;
    phone_e164: string | null;
    designation: string | null;
  }>(
    `SELECT u.id, u.name, u.phone_e164, p.designation FROM users u
       LEFT JOIN staff_profiles p ON p.user_id = u.id
      WHERE u.org_id = ?org AND u.id IN (SELECT value FROM json_each(?))`,
    jsonList([...new Set(userIds)]),
  );
  return new Map(rows.map((r) => [r.id, personBrief(r)]));
}

export async function advanceViews(ctx: Ctx, rows: readonly AdvanceRow[]): Promise<AdvanceView[]> {
  if (rows.length === 0) return [];
  const [people, recoveries] = await Promise.all([
    briefs(
      ctx,
      rows.map((r) => r.user_id),
    ),
    ctx.db.all<RecoveryRow>(
      `SELECT advance_id, month, payroll_run_id, scheduled_paise, recovered_paise, carried_paise
         FROM advance_recoveries WHERE org_id = ?org AND advance_id IN (SELECT value FROM json_each(?))
        ORDER BY month`,
      jsonList(rows.map((r) => r.id)),
    ),
  ]);
  return rows.map((a) => {
    const ledger = recoveries.filter((r) => r.advance_id === a.id);
    const recovered = ledger.reduce((s, r) => s + r.recovered_paise, 0);
    const owed = a.status === 'active' || a.status === 'closed';
    return {
      id: a.id,
      user: people.get(a.user_id) ?? { id: a.user_id, name: '', designation: null, phone: null },
      amountPaise: a.amount_paise,
      givenOn: a.given_on,
      mode: a.mode,
      reason: a.reason,
      plan: a.plan,
      instalmentsN: a.instalments_n,
      firstMonth: a.first_month,
      status: a.status,
      staffAck: a.staff_ack,
      staffAckAt: a.staff_ack_at,
      recoveredPaise: recovered,
      balancePaise: owed ? a.amount_paise - recovered : 0,
      ledger: ledger.map((r) => ({
        month: r.month,
        scheduledPaise: r.scheduled_paise,
        recoveredPaise: r.recovered_paise,
        carriedPaise: r.carried_paise,
        payrollRunId: r.payroll_run_id,
      })),
      createdAt: a.created_at,
    };
  });
}

async function load(ctx: Ctx, id: string): Promise<AdvanceRow> {
  const row = await ctx.db.first<AdvanceRow>(
    'SELECT * FROM advances WHERE org_id = ?org AND id = ?',
    id,
  );
  return row ?? fail('NOT_FOUND', 'That advance was not found.');
}

async function viewOf(ctx: Ctx, id: string): Promise<AdvanceView> {
  const [v] = await advanceViews(ctx, [await load(ctx, id)]);
  return v ?? fail('NOT_FOUND');
}

async function hasRecoveries(ctx: Ctx, id: string): Promise<boolean> {
  const r = await ctx.db.first<{ n: number }>(
    'SELECT COUNT(*) AS n FROM advance_recoveries WHERE org_id = ?org AND advance_id = ?',
    id,
  );
  return (r?.n ?? 0) > 0;
}

async function staffMember(ctx: Ctx, userId: string): Promise<{ id: string; name: string }> {
  const row = await ctx.db.first<{ id: string; name: string; status: string }>(
    `SELECT u.id, u.name, u.status FROM users u JOIN staff_profiles p ON p.user_id = u.id
      WHERE u.org_id = ?org AND u.id = ?`,
    userId,
  );
  if (!row || row.status === 'exited') fail('NOT_FOUND', 'That person was not found.');
  return row;
}

/** Instalments need a count; a full recovery has none. The first month cannot be a closed month. */
async function checkPlan(
  ctx: Ctx,
  plan: 'full' | 'instalments',
  n: number | undefined,
  firstMonth: string,
): Promise<number | null> {
  if (plan === 'instalments' && n === undefined) {
    fail('VALIDATION', 'Choose how many instalments.', {
      issues: [{ path: 'instalmentsN', message: 'Required for instalments', code: 'custom' }],
    });
  }
  const closed = await ctx.db.first<{ id: string }>(
    "SELECT id FROM payroll_runs WHERE org_id = ?org AND month = ? AND status = 'finalised' LIMIT 1",
    firstMonth,
  );
  if (closed)
    fail('MONTH_LOCKED', `${monthName(firstMonth)} payroll is already final. Pick a later month.`);
  return plan === 'full' ? null : (n ?? null);
}

export async function listAdvances(
  ctx: Ctx,
  q: { userId?: string | undefined; status?: 'open' | 'all' | undefined },
): Promise<OutputOf<Endpoints['ownerAdvancesList']>> {
  const rows = await ctx.db.all<AdvanceRow>(
    `SELECT * FROM advances WHERE org_id = ?org AND (? IS NULL OR user_id = ?)
        AND (? = 'all' OR status IN ('requested', 'active'))
      ORDER BY created_at DESC, id`,
    q.userId ?? null,
    q.userId ?? null,
    q.status ?? 'open',
  );
  const items = await advanceViews(ctx, rows);
  const totals = new Map<string, { user: PersonBrief; balancePaise: number }>();
  for (const v of items) {
    if (v.status !== 'active' || v.balancePaise <= 0) continue;
    const t = totals.get(v.user.id) ?? { user: v.user, balancePaise: 0 };
    t.balancePaise += v.balancePaise;
    totals.set(v.user.id, t);
  }
  return { items, balances: [...totals.values()].sort((a, b) => b.balancePaise - a.balancePaise) };
}

export const getAdvance = viewOf;

export async function createAdvance(ctx: Ctx, body: AdvanceCreate): Promise<AdvanceView> {
  const person = await staffMember(ctx, body.userId);
  const n = await checkPlan(ctx, body.plan, body.instalmentsN, body.firstMonth);
  const id = ulid(ctx.now());
  const row = {
    id,
    user_id: person.id,
    amount_paise: body.amountPaise,
    given_on: body.givenOn,
    mode: body.mode,
    reason: body.reason ?? null,
    plan: body.plan,
    instalments_n: n,
    first_month: body.firstMonth,
    status: 'active',
    staff_ack: 'pending',
    created_by: actor(ctx),
    created_at: ctx.now(),
  };
  await ctx.db.batch([
    ctx.db.insert('advances', row),
    ctx.services.audit.stmt(ctx, {
      category: 'change',
      action: 'advance.create',
      entity: 'advance',
      entityId: id,
      after: { ...row, askStaffAck: body.askStaffAck },
    }),
  ]);
  if (body.askStaffAck) {
    await ctx.services.notifier.emit(ctx, {
      type: 'advance_recorded',
      orgId: ctx.orgId ?? '',
      at: ctx.now(),
      userId: person.id,
      advanceId: id,
      amountPaise: body.amountPaise,
      givenOn: body.givenOn,
      recoverySummary: recoverySummary(body.amountPaise, row),
    });
  }
  return viewOf(ctx, id);
}

export async function patchAdvance(
  ctx: Ctx,
  id: string,
  body: ParsedInputOf<Endpoints['ownerAdvancePatch']>['body'],
): Promise<AdvanceView> {
  const before = await load(ctx, id);
  if (before.status !== 'active' && before.status !== 'requested') {
    fail('CONFLICT', 'This advance can no longer be edited.');
  }
  if (await hasRecoveries(ctx, id))
    fail('CONFLICT', 'Some of it is already recovered, so it cannot be edited.');
  const plan = body.plan ?? before.plan;
  const firstMonth = body.firstMonth ?? before.first_month;
  const n = await checkPlan(
    ctx,
    plan,
    body.instalmentsN ?? before.instalments_n ?? undefined,
    firstMonth,
  );
  const set = {
    amount_paise: body.amountPaise,
    given_on: body.givenOn,
    mode: body.mode,
    reason: body.reason,
    plan,
    instalments_n: n,
    first_month: firstMonth,
  };
  await ctx.db.batch([
    ctx.db.update('advances', set, 'id = ?', id),
    ctx.services.audit.stmt(ctx, {
      category: 'change',
      action: 'advance.update',
      entity: 'advance',
      entityId: id,
      before,
      after: set,
    }),
  ]);
  return viewOf(ctx, id);
}

export async function cancelAdvance(ctx: Ctx, id: string): Promise<void> {
  const before = await load(ctx, id);
  if (before.status === 'cancelled') return;
  if (before.status === 'closed' || (await hasRecoveries(ctx, id))) {
    fail('CONFLICT', 'Some of it is already recovered, so it cannot be cancelled.');
  }
  await ctx.db.batch([
    ctx.db.update('advances', { status: 'cancelled' }, 'id = ?', id),
    ctx.services.audit.stmt(ctx, {
      category: 'change',
      action: 'advance.cancel',
      entity: 'advance',
      entityId: id,
      before: { status: before.status },
      after: { status: 'cancelled' },
    }),
  ]);
}

export async function decideAdvance(
  ctx: Ctx,
  id: string,
  body: ParsedInputOf<Endpoints['ownerAdvanceDecide']>['body'],
): Promise<AdvanceView> {
  const before = await load(ctx, id);
  if (before.status !== 'requested') fail('ALREADY_DECIDED', 'This request was already decided.');
  const approve = body.decision === 'approve';
  const set = approve
    ? { status: 'active', given_on: body.givenOn ?? istDate(ctx.now()), mode: body.mode ?? 'cash' }
    : { status: 'rejected' };
  await ctx.db.batch([
    ctx.db.update('advances', set, 'id = ?', id),
    ctx.services.audit.stmt(ctx, {
      category: 'change',
      action: approve ? 'advance.approve' : 'advance.reject',
      entity: 'advance',
      entityId: id,
      before: { status: before.status },
      after: set,
      reason: body.note ?? null,
    }),
  ]);
  if (approve) {
    await ctx.services.notifier.emit(ctx, {
      type: 'advance_recorded',
      orgId: ctx.orgId ?? '',
      at: ctx.now(),
      userId: before.user_id,
      advanceId: id,
      amountPaise: before.amount_paise,
      givenOn: set.given_on as string,
      recoverySummary: recoverySummary(before.amount_paise, before),
    });
  }
  return viewOf(ctx, id);
}

// ---- Staff side -------------------------------------------------------------------------------

export async function myAdvances(ctx: Ctx): Promise<AdvanceView[]> {
  const rows = await ctx.db.all<AdvanceRow>(
    `SELECT * FROM advances WHERE org_id = ?org AND user_id = ? AND status <> 'cancelled'
      ORDER BY created_at DESC, id`,
    actor(ctx),
  );
  return advanceViews(ctx, rows);
}

export async function requestAdvance(
  ctx: Ctx,
  body: ParsedInputOf<Endpoints['advanceRequestCreate']>['body'],
): Promise<AdvanceView> {
  const user = ctx.user ?? fail('UNAUTHENTICATED');
  const firstMonth = shiftMonth(istDate(ctx.now()).slice(0, 7), 1);
  const n = await checkPlan(ctx, body.plan, body.instalmentsN, firstMonth);
  const open = await ctx.db.first<{ n: number }>(
    "SELECT COUNT(*) AS n FROM advances WHERE org_id = ?org AND user_id = ? AND status = 'requested'",
    user.id,
  );
  if ((open?.n ?? 0) >= 1) fail('DUPLICATE', 'You already have a request waiting for an answer.');
  const id = ulid(ctx.now());
  const row = {
    id,
    user_id: user.id,
    amount_paise: body.amountPaise,
    reason: body.reason,
    plan: body.plan,
    instalments_n: n,
    first_month: firstMonth,
    status: 'requested',
    staff_ack: 'pending',
    created_by: user.id,
    created_at: ctx.now(),
  };
  await ctx.db.batch([
    ctx.db.insert('advances', row),
    ctx.services.audit.stmt(ctx, {
      category: 'change',
      action: 'advance.request',
      entity: 'advance',
      entityId: id,
      after: row,
    }),
  ]);
  await ctx.services.notifier.emit(ctx, {
    type: 'advance_requested',
    orgId: ctx.orgId ?? '',
    at: ctx.now(),
    userId: user.id,
    name: user.name,
    advanceId: id,
    amountPaise: body.amountPaise,
    reason: body.reason,
  });
  return viewOf(ctx, id);
}

export async function ackAdvance(
  ctx: Ctx,
  id: string,
  body: ParsedInputOf<Endpoints['advanceAck']>['body'],
): Promise<AdvanceView> {
  const a = await load(ctx, id);
  if (a.user_id !== actor(ctx)) fail('NOT_FOUND', 'That advance was not found.');
  if (a.status !== 'active' && a.status !== 'closed')
    fail('CONFLICT', 'There is nothing to confirm yet.');
  await ctx.db.batch([
    ctx.db.update('advances', { staff_ack: body.answer, staff_ack_at: ctx.now() }, 'id = ?', id),
    ctx.services.audit.stmt(ctx, {
      category: 'change',
      action: `advance.ack_${body.answer}`,
      entity: 'advance',
      entityId: id,
      before: { staffAck: a.staff_ack },
      after: { staffAck: body.answer },
      reason: body.note ?? null,
    }),
  ]);
  return viewOf(ctx, id);
}
