/**
 * Leave (PRD 4.9, 7.8): balances from the ledger, the preview and its warnings, requests,
 * cancellation, owner decisions, ledger adjustments and the "checked in on a leave day" split.
 * Ledger convention: credits and restorations are positive, debits and expiries negative; the
 * balance is the sum. Owner: WP-4.
 */
import {
  addDays,
  datesBetween,
  istDate,
  type LeaveBalance,
  type LeaveCode,
  type LeaveOnDay,
  type LeavePreview,
  type LeaveRequestCreate,
  type LeaveRequestView,
} from '@fs/contracts';
import { fail } from '../lib/errors';
import { loadOrg } from '../lib/settings';
import { ulid } from '../lib/ulid';
import {
  countedLeaveDates,
  type DayData,
  jsonList,
  type LeaveRequestRow,
  type LeaveTypeRow,
  loadDayData,
  personBrief,
  scheduleFrom,
} from './day';
import type { Ctx } from './ports';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** `2026-10-26` -> `26 Oct`. */
export function shortDate(d: string): string {
  return `${Number(d.slice(8, 10))} ${(MONTHS[Number(d.slice(5, 7)) - 1] as string).slice(0, 3)}`;
}

export const monthName = (ym: string) => MONTHS[Number(ym.slice(5, 7)) - 1] as string;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

interface LedgerRow {
  id: string;
  leave_type_id: string;
  entry_date: string;
  kind: 'credit' | 'debit' | 'expire' | 'adjust';
  days: number;
  ref_type: string | null;
  ref_id: string | null;
  expires_on: string | null;
  note: string | null;
  created_at: number;
}

// ---- Month locks -------------------------------------------------------------------------------

/** Months (`YYYY-MM`) among `months` that are closed by a finalised payroll run (PRD 4.9, 4.11). */
export async function lockedMonths(ctx: Ctx, months: readonly string[]): Promise<string[]> {
  const list = [...new Set(months)];
  if (list.length === 0) return [];
  const rows = await ctx.db.all<{ month: string }>(
    `SELECT DISTINCT month FROM payroll_runs
      WHERE org_id = ?org AND status = 'finalised' AND month IN (SELECT value FROM json_each(?))
     UNION
     SELECT DISTINCT substr(work_date, 1, 7) AS month FROM attendance_days
      WHERE org_id = ?org AND locked = 1 AND substr(work_date, 1, 7) IN (SELECT value FROM json_each(?))`,
    jsonList(list),
    jsonList(list),
  );
  return rows.map((r) => r.month).sort();
}

// ---- Types and balances --------------------------------------------------------------------------

export async function leaveTypes(ctx: Ctx): Promise<LeaveTypeRow[]> {
  return ctx.db.all<LeaveTypeRow>('SELECT * FROM leave_types WHERE org_id = ?org ORDER BY code');
}

async function typeByCode(ctx: Ctx, code: LeaveCode): Promise<LeaveTypeRow> {
  const t = await ctx.db.first<LeaveTypeRow>(
    'SELECT * FROM leave_types WHERE org_id = ?org AND code = ? AND active = 1',
    code,
  );
  return t ?? fail('VALIDATION', 'This leave type is not available.', { field: 'typeCode' });
}

/** Comp-off is used oldest-expiry first; the next expiry is the first credit with days left. */
function nextExpiry(rows: LedgerRow[], today: string): LeaveBalance['nextExpiry'] {
  const credits = rows
    .filter((r) => r.days > 0 && r.expires_on)
    .sort((a, b) => (a.expires_on as string).localeCompare(b.expires_on as string))
    .map((r) => ({ on: r.expires_on as string, left: r.days }));
  let used = -rows.filter((r) => r.days < 0).reduce((s, r) => s + r.days, 0);
  for (const c of credits) {
    const take = Math.min(used, c.left);
    c.left -= take;
    used -= take;
  }
  const next = credits.find((c) => c.left > 0 && c.on >= today);
  return next ? { days: next.left, on: next.on } : null;
}

const PAID_BALANCE_CODES: readonly LeaveCode[] = ['CL', 'SL', 'EL', 'CO'];

export async function leaveBalances(ctx: Ctx, userId: string): Promise<LeaveBalance[]> {
  const { settings } = await loadOrg(ctx);
  const today = istDate(ctx.now());
  const [types, ledger, pending, profile] = await Promise.all([
    leaveTypes(ctx),
    ctx.db.all<LedgerRow>(
      'SELECT * FROM leave_ledger WHERE org_id = ?org AND user_id = ? ORDER BY entry_date, created_at',
      userId,
    ),
    ctx.db.all<{ leave_type_id: string; days: number }>(
      `SELECT leave_type_id, SUM(days_paid) AS days FROM leave_requests
        WHERE org_id = ?org AND user_id = ? AND status = 'pending' GROUP BY leave_type_id`,
      userId,
    ),
    ctx.db.first<{ join_date: string }>(
      'SELECT join_date FROM staff_profiles WHERE org_id = ?org AND user_id = ?',
      userId,
    ),
  ]);
  return types
    .filter((t) => t.active === 1)
    .map((t) => {
      const rows = ledger.filter((r) => r.leave_type_id === t.id);
      const balance = PAID_BALANCE_CODES.includes(t.code)
        ? Math.round(rows.reduce((s, r) => s + r.days, 0) * 2) / 2
        : 0;
      const usableAfter =
        t.code === 'CL' || t.code === 'SL' ? settings.leave.usableAfterDays : t.usable_after_days;
      return {
        code: t.code,
        name: t.name,
        paid: t.paid === 1,
        balance,
        pending: pending.find((p) => p.leave_type_id === t.id)?.days ?? 0,
        nextExpiry: t.code === 'CO' ? nextExpiry(rows, today) : null,
        usableFrom: profile && usableAfter > 0 ? addDays(profile.join_date, usableAfter) : null,
      };
    });
}

// ---- Views ---------------------------------------------------------------------------------------

interface LeaveViewRow extends LeaveRequestRow {
  name: string;
  designation: string | null;
  phone_e164: string | null;
  type_code: LeaveCode;
  type_name: string;
  decided_by_name: string | null;
}

const VIEW_SELECT = `SELECT r.*, u.name, u.phone_e164, p.designation, t.code AS type_code, t.name AS type_name,
       d.name AS decided_by_name
  FROM leave_requests r
  JOIN users u ON u.id = r.user_id
  LEFT JOIN staff_profiles p ON p.user_id = r.user_id
  JOIN leave_types t ON t.id = r.leave_type_id
  LEFT JOIN users d ON d.id = r.decided_by`;

function leaveView(r: LeaveViewRow): LeaveRequestView {
  return {
    id: r.id,
    user: personBrief(r),
    typeCode: r.type_code,
    typeName: r.type_name,
    fromDate: r.from_date,
    toDate: r.to_date,
    half: r.half,
    daysPaid: r.days_paid,
    daysUnpaid: r.days_unpaid,
    reason: r.reason,
    blackoutHit: r.blackout_hit === 1,
    status: r.status,
    decidedAt: r.decided_at,
    decidedByName: r.decided_by_name,
    decisionNote: r.decision_note,
    cancelledAt: r.cancelled_at,
    createdAt: r.created_at,
  };
}

export async function leaveRequestViews(
  ctx: Ctx,
  where: string,
  ...params: (string | number)[]
): Promise<LeaveRequestView[]> {
  const rows = await ctx.db.all<LeaveViewRow>(
    `${VIEW_SELECT} WHERE r.org_id = ?org AND (${where}) ORDER BY r.from_date DESC, r.created_at DESC`,
    ...params,
  );
  return rows.map(leaveView);
}

export async function leaveRequestView(ctx: Ctx, id: string): Promise<LeaveRequestView> {
  const [v] = await leaveRequestViews(ctx, 'r.id = ?', id);
  return v ?? fail('NOT_FOUND');
}

async function requestRow(ctx: Ctx, id: string): Promise<LeaveRequestRow> {
  const r = await ctx.db.first<LeaveRequestRow>(
    'SELECT * FROM leave_requests WHERE org_id = ?org AND id = ?',
    id,
  );
  return r ?? fail('NOT_FOUND');
}

// ---- Preview (PRD 4.9 step 4) -------------------------------------------------------------------

export interface LeavePlan {
  preview: LeavePreview;
  type: LeaveTypeRow;
  counted: string[];
  blackoutHit: boolean;
}

export async function previewLeave(
  ctx: Ctx,
  userId: string,
  body: LeaveRequestCreate,
): Promise<LeavePlan> {
  if (body.toDate < body.fromDate) {
    fail('VALIDATION', 'The last day must be on or after the first day.', { field: 'toDate' });
  }
  if (datesBetween(body.fromDate, body.toDate).length > 62) {
    fail('VALIDATION', 'Ask for at most two months at a time.', { field: 'toDate' });
  }
  const half = body.half ?? 'none';
  if (half !== 'none' && body.fromDate !== body.toDate) {
    fail('VALIDATION', 'A half day is for one date.', { field: 'half' });
  }
  const { org, settings } = await loadOrg(ctx);
  const owner = org.owner_display_name;
  const today = istDate(ctx.now());
  const type = await typeByCode(ctx, body.typeCode);
  const data = await loadDayData(ctx, [userId], body.fromDate, body.toDate, settings);
  if (!data.people.has(userId)) fail('NOT_FOUND', 'Your profile is not set up yet.');

  const counted: string[] = [];
  const excluded: LeavePreview['excluded'] = [];
  for (const d of datesBetween(body.fromDate, body.toDate)) {
    const s = scheduleFrom(data, userId, d);
    if (s?.dayType === 'work') counted.push(d);
    else if (s?.dayType === 'WO') excluded.push({ date: d, reason: 'week_off' });
    else if (s?.dayType === 'HO') excluded.push({ date: d, reason: 'holiday' });
  }
  const countedDays = half !== 'none' ? (counted.length > 0 ? 0.5 : 0) : counted.length;
  const warnings: LeavePreview['warnings'] = [];

  if (type.code === 'LOP' && !body.reason) {
    warnings.push({
      code: 'reason_required',
      message: `Tell ${owner} why you need unpaid leave.`,
      blocking: true,
    });
  }
  const overlap = await ctx.db.first<{ from_date: string; to_date: string }>(
    `SELECT from_date, to_date FROM leave_requests
      WHERE org_id = ?org AND user_id = ? AND status IN ('pending', 'approved')
        AND from_date <= ? AND to_date >= ? ORDER BY from_date LIMIT 1`,
    userId,
    body.toDate,
    body.fromDate,
  );
  if (overlap) {
    const first = overlap.from_date > body.fromDate ? overlap.from_date : body.fromDate;
    warnings.push({
      code: 'overlap',
      message: `You already asked for ${shortDate(first)}.`,
      blocking: true,
    });
  }
  const locked = await lockedMonths(
    ctx,
    datesBetween(body.fromDate, body.toDate).map((d) => d.slice(0, 7)),
  );
  if (locked.length > 0) {
    warnings.push({
      code: 'locked',
      message: `${monthName(locked[0] as string)} is closed. Ask ${owner}.`,
      blocking: true,
    });
  }
  if (body.fromDate < today) {
    const back = datesBetween(body.fromDate, today).length - 1;
    if (type.code !== 'SL') {
      warnings.push({
        code: 'backdate',
        message: `Leave can't start in the past. Ask ${owner} to fix past days.`,
        blocking: true,
      });
    } else if (back > settings.leave.slBackdateDays) {
      warnings.push({
        code: 'backdate',
        message: `Sick leave can go back at most ${plural(settings.leave.slBackdateDays, 'day', 'days')}.`,
        blocking: true,
      });
    }
  } else if (type.code === 'CL' && body.fromDate < addDays(today, settings.leave.clNoticeDays)) {
    warnings.push({
      code: 'notice',
      message: `Casual leave needs ${plural(settings.leave.clNoticeDays, "day's", "days'")} notice. ${owner} may say no.`,
      blocking: false,
    });
  }

  let daysPaid = 0;
  let daysUnpaid = countedDays;
  if (type.paid === 1) {
    const balance = (await leaveBalances(ctx, userId)).find((b) => b.code === type.code);
    if (balance?.usableFrom && body.fromDate < balance.usableFrom) {
      warnings.push({
        code: 'usable_after',
        message: `You can use ${type.name.toLowerCase()} from ${shortDate(balance.usableFrom)}. Ask for unpaid leave instead.`,
        blocking: true,
      });
    }
    const available = Math.max(
      0,
      Math.floor(((balance?.balance ?? 0) - (balance?.pending ?? 0)) * 2) / 2,
    );
    daysPaid = Math.min(countedDays, available);
    daysUnpaid = countedDays - daysPaid;
    if (daysUnpaid > 0) {
      warnings.push({
        code: 'balance',
        message:
          available > 0
            ? `You have ${plural(available, type.name.toLowerCase(), `${type.name.toLowerCase()}s`)} left. The other ${plural(daysUnpaid, 'day', 'days')} will be unpaid.`
            : `You have no ${type.name.toLowerCase()} left. ${daysUnpaid === 1 ? 'This day' : `All ${daysUnpaid} days`} will be unpaid.`,
        blocking: !body.acceptUnpaidSplit,
      });
    }
  }

  const blackout = await ctx.db.all<{ date: string; note: string | null }>(
    `SELECT date, note FROM blackout_days WHERE org_id = ?org AND date IN (SELECT value FROM json_each(?))
      ORDER BY date`,
    jsonList(counted),
  );
  const firstBlackout = blackout[0];
  if (firstBlackout) {
    warnings.push({
      code: 'blackout',
      message: `${shortDate(firstBlackout.date)} is a no-leave day${firstBlackout.note ? ` (${firstBlackout.note})` : ''}. ${owner} may say no.`,
      blocking: false,
    });
  }

  return {
    preview: { countedDays, excluded, daysPaid, daysUnpaid, warnings },
    type,
    counted,
    blackoutHit: blackout.length > 0,
  };
}

// ---- Requests ----------------------------------------------------------------------------------

export async function createLeave(ctx: Ctx, body: LeaveRequestCreate): Promise<LeaveRequestView> {
  const user = ctx.user ?? fail('UNAUTHENTICATED');
  const plan = await previewLeave(ctx, user.id, body);
  const block = plan.preview.warnings.find((w) => w.blocking);
  if (block) {
    const code =
      block.code === 'locked'
        ? 'MONTH_LOCKED'
        : block.code === 'overlap'
          ? 'CONFLICT'
          : 'RULE_VIOLATION';
    fail(code, block.message, { reason: block.code === 'balance' ? 'unpaid_split' : block.code });
  }
  if (plan.preview.countedDays === 0) {
    fail('RULE_VIOLATION', 'Those days are already off for you.', { reason: 'no_working_days' });
  }
  const now = ctx.now();
  const id = ulid(now);
  await ctx.db.batch([
    ctx.db.insert('leave_requests', {
      id,
      user_id: user.id,
      leave_type_id: plan.type.id,
      from_date: body.fromDate,
      to_date: body.toDate,
      half: body.half ?? 'none',
      days_paid: plan.preview.daysPaid,
      days_unpaid: plan.preview.daysUnpaid,
      reason: body.reason ?? null,
      blackout_hit: plan.blackoutHit,
      status: 'pending',
      created_at: now,
    }),
    ctx.services.audit.stmt(ctx, {
      category: 'change',
      action: 'leave.request',
      entity: 'leave_request',
      entityId: id,
      after: { ...body, daysPaid: plan.preview.daysPaid, daysUnpaid: plan.preview.daysUnpaid },
    }),
  ]);
  const today = istDate(now);
  ctx.waitUntil(
    emitSafe(ctx, {
      type: 'leave_requested',
      orgId: ctx.orgId as string,
      at: now,
      userId: user.id,
      name: user.name,
      requestId: id,
      typeCode: plan.type.code,
      fromDate: body.fromDate,
      toDate: body.toDate,
      reason: body.reason ?? null,
      urgent: body.fromDate <= addDays(today, 1),
    }),
  );
  return leaveRequestView(ctx, id);
}

async function emitSafe(ctx: Ctx, e: Parameters<Ctx['services']['notifier']['emit']>[1]) {
  try {
    await ctx.services.notifier.emit(ctx, e);
  } catch (err) {
    console.error(
      JSON.stringify({
        msg: 'notify.emit_failed',
        type: e.type,
        requestId: ctx.requestId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

function restoreStmt(
  ctx: Ctx,
  req: LeaveRequestRow,
  days: number,
  note: string,
  entryDate: string,
): D1PreparedStatement {
  return ctx.db.insert('leave_ledger', {
    id: ulid(ctx.now()),
    user_id: req.user_id,
    leave_type_id: req.leave_type_id,
    entry_date: entryDate,
    kind: 'adjust',
    days,
    ref_type: 'leave_request',
    ref_id: req.id,
    note,
    created_by: ctx.user?.id ?? 'system',
    created_at: ctx.now(),
  });
}

/** Paid days first (PRD 7.8): split `paid` days over the counted dates of two pieces. */
function splitPaid(paid: number, a: number, b: number) {
  const aPaid = Math.min(paid, a);
  const bPaid = Math.max(0, Math.min(paid - aPaid, b));
  return { aPaid, aUnpaid: a - aPaid, bPaid, bUnpaid: b - bPaid };
}

/** Staff cancels: before a decision always; after approval only the future days (PRD 4.9). */
export async function cancelLeave(ctx: Ctx, id: string): Promise<LeaveRequestView> {
  const user = ctx.user ?? fail('UNAUTHENTICATED');
  const req = await requestRow(ctx, id);
  if (req.user_id !== user.id) fail('NOT_FOUND');
  const now = ctx.now();
  const today = istDate(now);
  const { org } = await loadOrg(ctx);
  const stmts: D1PreparedStatement[] = [];
  let after: Record<string, unknown>;
  if (req.status === 'pending') {
    stmts.push(
      ctx.db.update('leave_requests', { status: 'cancelled', cancelled_at: now }, 'id = ?', id),
    );
    after = { status: 'cancelled' };
  } else if (req.status === 'approved') {
    if (req.from_date <= today && req.to_date <= today) {
      fail('RULE_VIOLATION', `This leave has already started. Ask ${org.owner_display_name}.`, {
        reason: 'started',
      });
    }
    const type = await ctx.db.first<LeaveTypeRow>(
      'SELECT * FROM leave_types WHERE org_id = ?org AND id = ?',
      req.leave_type_id,
    );
    if (req.from_date > today) {
      stmts.push(
        ctx.db.update('leave_requests', { status: 'cancelled', cancelled_at: now }, 'id = ?', id),
      );
      if (type?.paid === 1 && req.days_paid > 0) {
        stmts.push(restoreStmt(ctx, req, req.days_paid, 'Leave cancelled', today));
      }
      after = { status: 'cancelled' };
    } else {
      const data = await loadDayData(ctx, [req.user_id], req.from_date, req.to_date);
      const kept = countedLeaveDates(data, req).filter((d) => d <= today).length;
      const { aPaid, aUnpaid } = splitPaid(req.days_paid, kept, 0);
      stmts.push(
        ctx.db.update(
          'leave_requests',
          { to_date: today, days_paid: aPaid, days_unpaid: aUnpaid },
          'id = ?',
          id,
        ),
      );
      if (type?.paid === 1 && req.days_paid - aPaid > 0) {
        stmts.push(restoreStmt(ctx, req, req.days_paid - aPaid, 'Later days cancelled', today));
      }
      after = { toDate: today, daysPaid: aPaid, daysUnpaid: aUnpaid };
    }
  } else {
    return fail('ALREADY_DECIDED', 'This request is already closed.');
  }
  stmts.push(
    ctx.services.audit.stmt(ctx, {
      category: 'change',
      action: 'leave.cancel',
      entity: 'leave_request',
      entityId: id,
      before: { status: req.status, toDate: req.to_date, daysPaid: req.days_paid },
      after,
    }),
  );
  await ctx.db.batch(stmts);
  return leaveRequestView(ctx, id);
}

/** Owner approves or rejects (PRD 4.9): approval writes the ledger debit and the days. */
export async function decideLeave(
  ctx: Ctx,
  id: string,
  body: { decision: 'approve' | 'reject'; note?: string | undefined },
): Promise<LeaveRequestView> {
  const req = await requestRow(ctx, id);
  if (req.status !== 'pending') fail('ALREADY_DECIDED');
  if (body.decision === 'reject' && !body.note) {
    fail('VALIDATION', 'Add a reason so they know why.', { field: 'note' });
  }
  const locked = await lockedMonths(
    ctx,
    datesBetween(req.from_date, req.to_date).map((d) => d.slice(0, 7)),
  );
  if (locked.length > 0) fail('MONTH_LOCKED', `${monthName(locked[0] as string)} is closed.`);
  const now = ctx.now();
  const approve = body.decision === 'approve';
  const type = await ctx.db.first<LeaveTypeRow>(
    'SELECT * FROM leave_types WHERE org_id = ?org AND id = ?',
    req.leave_type_id,
  );
  const stmts: D1PreparedStatement[] = [
    ctx.db.update(
      'leave_requests',
      {
        status: approve ? 'approved' : 'rejected',
        decided_by: ctx.user?.id ?? null,
        decided_at: now,
        decision_note: body.note ?? null,
      },
      "id = ? AND status = 'pending'",
      id,
    ),
  ];
  if (approve && type?.paid === 1 && req.days_paid > 0) {
    stmts.push(
      ctx.db.insert('leave_ledger', {
        id: ulid(now),
        user_id: req.user_id,
        leave_type_id: req.leave_type_id,
        entry_date: req.from_date,
        kind: 'debit',
        days: -req.days_paid,
        ref_type: 'leave_request',
        ref_id: req.id,
        created_by: ctx.user?.id ?? 'system',
        created_at: now,
      }),
    );
  }
  stmts.push(
    ctx.services.audit.stmt(ctx, {
      category: 'change',
      action: approve ? 'leave.approve' : 'leave.reject',
      entity: 'leave_request',
      entityId: id,
      before: { status: 'pending' },
      after: { status: approve ? 'approved' : 'rejected' },
      reason: body.note ?? null,
    }),
  );
  await ctx.db.batch(stmts);
  if (approve) {
    const today = istDate(now);
    for (const d of datesBetween(req.from_date, req.to_date)) {
      if (d <= today) await ctx.services.days.recompute(ctx, req.user_id, d);
    }
  }
  ctx.waitUntil(
    emitSafe(ctx, {
      type: 'leave_decided',
      orgId: ctx.orgId as string,
      at: now,
      userId: req.user_id,
      requestId: id,
      fromDate: req.from_date,
      toDate: req.to_date,
      decision: approve ? 'approved' : 'rejected',
      note: body.note ?? null,
    }),
  );
  return leaveRequestView(ctx, id);
}

/**
 * Checking in on an approved leave day cancels that day's leave and restores the balance
 * (PRD 4.3.2, 4.9). Returns the statements and updates `data` so the day recomputes without it.
 */
export async function leaveDayCancelStmts(
  ctx: Ctx,
  data: DayData,
  leave: LeaveOnDay,
  date: string,
  userId: string,
): Promise<D1PreparedStatement[]> {
  const list = data.leaves.get(userId) ?? [];
  const req = list.find((r) => r.id === leave.requestId);
  if (!req) return [];
  const counted = countedLeaveDates(data, req);
  const idx = counted.indexOf(date);
  const unit = req.half === 'none' ? 1 : 0.5;
  const paidDay = leave.paid && idx >= 0 && idx < req.days_paid;
  const paid = req.days_paid - (paidDay ? unit : 0);
  const a = counted.filter((d) => d < date).length;
  const b = counted.filter((d) => d > date).length;
  const now = ctx.now();
  const stmts: D1PreparedStatement[] = [];
  const remaining: LeaveRequestRow[] = [];
  if (a === 0 && b === 0) {
    stmts.push(
      ctx.db.update('leave_requests', { status: 'cancelled', cancelled_at: now }, 'id = ?', req.id),
    );
  } else {
    const s = splitPaid(paid, a, b);
    if (a > 0) {
      const upd = { to_date: addDays(date, -1), days_paid: s.aPaid, days_unpaid: s.aUnpaid };
      stmts.push(ctx.db.update('leave_requests', upd, 'id = ?', req.id));
      remaining.push({ ...req, ...upd });
    }
    if (b > 0) {
      const piece = {
        from_date: addDays(date, 1),
        to_date: req.to_date,
        days_paid: s.bPaid,
        days_unpaid: s.bUnpaid,
      };
      if (a > 0) {
        const newId = ulid(now);
        stmts.push(
          ctx.db.insert('leave_requests', {
            id: newId,
            user_id: req.user_id,
            leave_type_id: req.leave_type_id,
            half: req.half,
            reason: req.reason,
            blackout_hit: req.blackout_hit,
            status: 'approved',
            decided_by: req.decided_by,
            decided_at: req.decided_at,
            decision_note: req.decision_note,
            created_at: req.created_at,
            ...piece,
          }),
        );
        remaining.push({ ...req, ...piece, id: newId });
      } else {
        stmts.push(ctx.db.update('leave_requests', piece, 'id = ?', req.id));
        remaining.push({ ...req, ...piece });
      }
    }
  }
  if (paidDay) stmts.push(restoreStmt(ctx, req, unit, `Checked in on ${shortDate(date)}`, date));
  stmts.push(
    ctx.services.audit.stmt(ctx, {
      category: 'change',
      action: 'leave.cancel_day',
      entity: 'leave_request',
      entityId: req.id,
      before: { fromDate: req.from_date, toDate: req.to_date, daysPaid: req.days_paid },
      after: { cancelledDate: date, restored: paidDay ? unit : 0 },
    }),
  );
  data.leaves.set(userId, [...list.filter((r) => r.id !== req.id), ...remaining]);
  data.leaveDates.clear();
  return stmts;
}

// ---- Owner: balances, ledger, adjustments --------------------------------------------------------

export async function staffLeaveView(ctx: Ctx, userId: string) {
  const exists = await ctx.db.first<{ id: string }>(
    'SELECT id FROM users WHERE org_id = ?org AND id = ?',
    userId,
  );
  if (!exists) fail('NOT_FOUND');
  const [balances, ledger, requests] = await Promise.all([
    leaveBalances(ctx, userId),
    ctx.db.all<LedgerRow & { code: LeaveCode }>(
      `SELECT l.*, t.code FROM leave_ledger l JOIN leave_types t ON t.id = l.leave_type_id
        WHERE l.org_id = ?org AND l.user_id = ? ORDER BY l.entry_date DESC, l.created_at DESC`,
      userId,
    ),
    leaveRequestViews(ctx, 'r.user_id = ?', userId),
  ]);
  return {
    balances,
    ledger: ledger.map((r) => ({
      id: r.id,
      code: r.code,
      entryDate: r.entry_date,
      kind: r.kind,
      days: r.days,
      note: r.note,
      expiresOn: r.expires_on,
      createdAt: r.created_at,
    })),
    requests,
  };
}

export async function adjustLeave(
  ctx: Ctx,
  userId: string,
  body: { code: LeaveCode; days: number; note: string },
) {
  if (body.code === 'LOP') {
    fail('VALIDATION', 'Unpaid leave has no balance to adjust.', { field: 'code' });
  }
  const view = await staffLeaveView(ctx, userId);
  const type = await typeByCode(ctx, body.code);
  const now = ctx.now();
  const id = ulid(now);
  const before = view.balances.find((b) => b.code === body.code)?.balance ?? 0;
  await ctx.db.batch([
    ctx.db.insert('leave_ledger', {
      id,
      user_id: userId,
      leave_type_id: type.id,
      entry_date: istDate(now),
      kind: 'adjust',
      days: body.days,
      ref_type: 'owner_adjust',
      note: body.note,
      created_by: ctx.user?.id ?? 'system',
      created_at: now,
    }),
    ctx.services.audit.stmt(ctx, {
      category: 'change',
      action: 'leave.adjust',
      entity: 'leave_ledger',
      entityId: id,
      before: { code: body.code, balance: before },
      after: { code: body.code, balance: before + body.days, days: body.days },
      reason: body.note,
    }),
  ]);
  return staffLeaveView(ctx, userId);
}

/** Staff "My leave": balances, requests of the last year, upcoming no-leave days. */
export async function myLeave(ctx: Ctx) {
  const user = ctx.user ?? fail('UNAUTHENTICATED');
  const today = istDate(ctx.now());
  const [balances, requests, blackout] = await Promise.all([
    leaveBalances(ctx, user.id),
    leaveRequestViews(ctx, 'r.user_id = ? AND r.to_date >= ?', user.id, addDays(today, -366)),
    ctx.db.all<{ date: string; note: string | null }>(
      'SELECT date, note FROM blackout_days WHERE org_id = ?org AND date BETWEEN ? AND ? ORDER BY date',
      today,
      addDays(today, 366),
    ),
  ]);
  return { balances, requests, blackoutDays: blackout };
}
