/**
 * Payroll inputs and results (PRD 4.13, 7.10): loads a month for everyone employed in it, runs the
 * engine per person and finds the blockers. Pure reads; PayrollService writes the results.
 * A draft is never stored as payslips: it is computed from live data every time it is opened, with
 * the settings snapshot taken when the run was created or last recomputed. Owner: WP-5.
 */
import {
  type Adjustment,
  type AdvanceSchedule,
  type CarryForward,
  daysInMonth,
  type Fine,
  monthDates,
  type OrgSettings,
  type OtDecision,
  type PayrollBlocker,
  type PayslipResult,
  type PersonPay,
} from '@fs/contracts';
import {
  advanceInstalment,
  computePayslip,
  creditRate,
  dailyRate,
  divisorDays,
  lateFines,
  payRulesFromSettings,
  salaryParts,
} from '@fs/engine';
import { json } from '../db';
import { balancesOn, type CreditSettlementRow } from './credit-entries';
import { draftSettlements, type PersonCredit } from './credit-settlement';
import {
  type Computed,
  computeFrom,
  type DayData,
  dayKey,
  jsonList,
  loadDayData,
  type ProfileRow,
  personBrief,
} from './day';
import type { Ctx } from './ports';

/** `settings_snapshot_json` of a run: the pay settings in force plus what the owner chose in review. */
export interface RunSnapshot {
  settings: OrgSettings;
  /** Lowered advance recoveries for this run (PRD 4.13.3). */
  overrides: { userId: string; advanceId: string; recoverPaise: number }[];
  /** Differences to settle in the next month's run after a reopen with "settle next month". */
  settle?: { userId: string; diffPaise: number }[];
  /** Set on a revision created by a reopen. */
  settleMode?: 'next_month' | 'reissue';
}

export interface AdjustmentRow {
  id: string;
  user_id: string;
  kind: Adjustment['kind'];
  amount_paise: number;
  note: string;
  show_cause_ref: string | null;
  created_by: string;
  created_at: number;
}

export interface AdvanceRow {
  id: string;
  user_id: string;
  amount_paise: number;
  given_on: string | null;
  mode: 'cash' | 'upi' | 'bank' | null;
  reason: string | null;
  plan: 'full' | 'instalments';
  instalments_n: number | null;
  first_month: string;
  status: 'requested' | 'active' | 'closed' | 'rejected' | 'cancelled';
  staff_ack: 'pending' | 'confirmed' | 'disputed';
  staff_ack_at: number | null;
  created_by: string;
  created_at: number;
}

export interface RunRow {
  id: string;
  month: string;
  revision: number;
  status: 'draft' | 'finalised' | 'superseded';
  settings_snapshot_json: string;
  engine_version: string;
  created_by: string;
  created_at: number;
  opened_at: number | null;
  finalised_by: string | null;
  finalised_at: number | null;
  reopened_reason: string | null;
}

export interface PersonCalc {
  profile: ProfileRow;
  person: PersonPay;
  days: Computed[];
  result: PayslipResult;
  adjustments: AdjustmentRow[];
  /** Time credits: balance on the month end, the owner's choice and what the engine applied. */
  credit: PersonCredit;
}

export interface RunCalc {
  month: string;
  data: DayData;
  people: PersonCalc[];
  blockers: PayrollBlocker[];
}

export const monthStart = (month: string) => `${month}-01`;
export const monthEnd = (month: string) =>
  `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;

export function shiftMonth(month: string, delta: number): string {
  const index = Number(month.slice(0, 4)) * 12 + (Number(month.slice(5, 7)) - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

export const parseSnapshot = (raw: string): RunSnapshot =>
  json<RunSnapshot>(raw, {} as RunSnapshot);

interface SalaryHistoryRow {
  user_id: string;
  effective_from: string;
  salary_type: 'monthly' | 'daily';
  amount_paise: number;
}

/** Advance instalments due in `month` per person: this month's instalment plus what was carried. */
export async function advanceSchedules(
  ctx: Ctx,
  month: string,
  userIds: readonly string[],
  overrides: RunSnapshot['overrides'],
): Promise<Map<string, AdvanceSchedule[]>> {
  const out = new Map<string, AdvanceSchedule[]>();
  if (userIds.length === 0) return out;
  const [advances, recovered] = await Promise.all([
    ctx.db.all<AdvanceRow>(
      `SELECT * FROM advances WHERE org_id = ?org AND status = 'active' AND first_month <= ?
        AND user_id IN (SELECT value FROM json_each(?)) ORDER BY created_at, id`,
      month,
      jsonList(userIds),
    ),
    ctx.db.all<{ advance_id: string; paise: number }>(
      `SELECT advance_id, SUM(recovered_paise) AS paise FROM advance_recoveries
        WHERE org_id = ?org AND month < ? GROUP BY advance_id`,
      month,
    ),
  ]);
  const before = new Map(recovered.map((r) => [r.advance_id, r.paise]));
  for (const a of advances) {
    const done = before.get(a.id) ?? 0;
    let scheduled = 0;
    for (let m = a.first_month; m <= month; m = shiftMonth(m, 1)) {
      scheduled += advanceInstalment(
        {
          amountPaise: a.amount_paise,
          plan: a.plan,
          instalmentsN: a.instalments_n,
          firstMonth: a.first_month,
        },
        m,
      );
    }
    const due = Math.min(a.amount_paise - done, Math.max(0, scheduled - done));
    if (due <= 0) continue;
    const override = overrides.find((o) => o.userId === a.user_id && o.advanceId === a.id);
    const list = out.get(a.user_id) ?? [];
    list.push({ advanceId: a.id, duePaise: due, overridePaise: override?.recoverPaise ?? null });
    out.set(a.user_id, list);
  }
  return out;
}

/** What the previous month's finalised run carried over (cap carry-forward, settle after a reopen). */
async function carriedIn(
  ctx: Ctx,
  month: string,
): Promise<{ carry: Map<string, CarryForward>; settle: Map<string, number> }> {
  const carry = new Map<string, CarryForward>();
  const settle = new Map<string, number>();
  const prev = await ctx.db.first<{ id: string; settings_snapshot_json: string }>(
    `SELECT id, settings_snapshot_json FROM payroll_runs
      WHERE org_id = ?org AND month = ? AND status = 'finalised' ORDER BY revision DESC LIMIT 1`,
    shiftMonth(month, -1),
  );
  if (!prev) return { carry, settle };
  const slips = await ctx.db.all<{ user_id: string; snapshot_json: string }>(
    'SELECT user_id, snapshot_json FROM payslips WHERE org_id = ?org AND payroll_run_id = ?',
    prev.id,
  );
  for (const s of slips) {
    const snap = json<{ result?: PayslipResult }>(s.snapshot_json, {});
    if (snap.result?.carryOut) carry.set(s.user_id, snap.result.carryOut);
  }
  for (const s of parseSnapshot(prev.settings_snapshot_json).settle ?? []) {
    settle.set(s.userId, s.diffPaise);
  }
  return { carry, settle };
}

const NO_CARRY: CarryForward = { advances: [], damagePaise: 0, otherPaise: 0, fines: [] };

/** First day of the calendar quarter that contains `month`. */
const quarterStart = (month: string) =>
  `${month.slice(0, 4)}-${String(Math.floor((Number(month.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, '0')}-01`;

export interface CalcOptions {
  month: string;
  settings: OrgSettings;
  overrides: RunSnapshot['overrides'];
  /** Run whose adjustments to use; null for a preview with none. */
  runId: string | null;
  /** Limit to one person (the per-person payslip preview). */
  userId?: string;
  /** "Payroll so far": pay only up to this date. */
  until?: string;
  /** Settlement minutes to use instead of the saved draft ones (the person's settle step). */
  settlements?: ReadonlyMap<string, number>;
}

/** Everything the engine needs, per person, and its result. */
export async function calcRun(ctx: Ctx, o: CalcOptions): Promise<RunCalc> {
  const { month, settings } = o;
  const from = monthStart(month);
  const to = monthEnd(month);
  const data = await loadDayData(ctx, o.userId ? [o.userId] : null, from, to, settings);
  const eligible = [...data.people.values()].filter(
    (p) =>
      p.status !== 'invited' && p.join_date <= to && (p.exit_date === null || p.exit_date >= from),
  );
  const ids = eligible.map((p) => p.user_id);

  const [salaryRows, adjustmentRows, quarterRows, carried, schedules, balances, drafts] =
    await Promise.all([
      ctx.db.all<SalaryHistoryRow>(
        'SELECT user_id, effective_from, salary_type, amount_paise FROM salary_history WHERE org_id = ?org AND effective_from <= ?',
        to,
      ),
      o.runId
        ? ctx.db.all<AdjustmentRow>(
            'SELECT * FROM adjustments WHERE org_id = ?org AND payroll_run_id = ? ORDER BY created_at, id',
            o.runId,
          )
        : Promise.resolve([] as AdjustmentRow[]),
      ctx.db.all<{ user_id: string; min: number }>(
        `SELECT user_id, SUM(ot_approved_min) AS min FROM attendance_days
        WHERE org_id = ?org AND work_date >= ? AND work_date < ? GROUP BY user_id`,
        quarterStart(month),
        from,
      ),
      carriedIn(ctx, month),
      advanceSchedules(ctx, month, ids, o.overrides),
      balancesOn(ctx, ids, to),
      o.runId
        ? draftSettlements(ctx, o.runId)
        : Promise.resolve(new Map<string, CreditSettlementRow>()),
    ]);
  const rules = payRulesFromSettings(settings);
  const holidays = data.holidays.filter((h) => h.date >= from && h.date <= to);
  const quarterMin = new Map(quarterRows.map((r) => [r.user_id, r.min]));

  const people: PersonCalc[] = [];
  for (const profile of eligible) {
    const history = salaryRows.filter((r) => r.user_id === profile.user_id);
    const parts = salaryParts(
      history.map((r) => ({
        effectiveFrom: r.effective_from,
        type: r.salary_type,
        amountPaise: r.amount_paise,
      })),
      month,
    );
    if (parts.length === 0) continue;
    const days = monthDates(month)
      .map((d) => computeFrom(data, profile.user_id, d))
      .filter((c): c is Computed => c !== null);
    const stdMin = days.find((c) => c.schedule.stdMin > 0)?.schedule.stdMin ?? 540;
    const exitDate =
      o.until !== undefined && o.until < (profile.exit_date ?? to) ? o.until : profile.exit_date;
    const person: PersonPay = {
      userId: profile.user_id,
      joinDate: profile.join_date,
      exitDate,
      salaryParts: parts,
      divisor: profile.divisor_override ?? settings.pay.divisor,
      otRate: json(profile.ot_rate_override_json, settings.overtime.rate),
      stdMin,
      workingDays: days.filter((c) => c.schedule.dayType === 'work').length,
    };
    const approvals: OtDecision[] = [];
    for (const c of days) {
      const d = data.otDecisions.get(dayKey(profile.user_id, c.date));
      if (d) {
        approvals.push({
          workDate: c.date,
          candidateMin: d.candidate_min,
          approvedMin: d.approved_min,
          decision: d.decision,
        });
      }
    }
    const mine = adjustmentRows.filter((a) => a.user_id === profile.user_id);
    const adjustments: Adjustment[] = mine.map((a) => ({
      id: a.id,
      kind: a.kind,
      amountPaise: a.amount_paise,
      note: a.note,
    }));
    const settleDiff = carried.settle.get(profile.user_id) ?? 0;
    if (settleDiff !== 0) {
      adjustments.push({
        id: `settle-${profile.user_id}`,
        kind: settleDiff > 0 ? 'arrears' : 'recovery',
        amountPaise: Math.abs(settleDiff),
        note: 'Difference from the reopened payroll',
      });
    }
    const dayResults = days.map((c) => c.result);
    const fines: Fine[] = [];
    if (settings.pay.fines.enabled) {
      const last = parts[parts.length - 1] as (typeof parts)[number];
      const rate = dailyRate(
        last.type,
        last.amountPaise,
        divisorDays(person.divisor, month, person.workingDays),
      );
      const lf = lateFines(dayResults, settings.pay.fines.latesPerHalfDay, rate);
      for (let i = 0; i < lf.count; i++) {
        fines.push({
          id: `late-${profile.user_id}-${month}-${i + 1}`,
          amountPaise: lf.finePaise,
          fineDate: to,
        });
      }
    }
    // Time credits (PRD 7.17): the balance on the month end and the owner's settlement choice.
    const balanceMin = balances.get(profile.user_id) ?? 0;
    const chosen =
      o.settlements?.get(profile.user_id) ?? drafts.get(profile.user_id)?.settle_min ?? 0;
    const rate = creditRate(person, month);
    const settlement =
      o.runId !== null && chosen !== 0 && balanceMin !== 0
        ? { balanceMin, settleMin: chosen, rate }
        : null;
    const result = computePayslip({
      person,
      month,
      days: dayResults,
      approvals,
      advances: schedules.get(profile.user_id) ?? [],
      adjustments,
      fines,
      rules,
      carryIn: carried.carry.get(profile.user_id) ?? NO_CARRY,
      holidays,
      limits: {
        weeklyHours: settings.overtime.weeklyHoursWarn,
        quarterlyOtHours: settings.overtime.quarterlyOtWarnHours,
      },
      quarterOtMinBefore: quarterMin.get(profile.user_id) ?? 0,
      creditDays: days.filter((c) => c.creditsOn).map((c) => c.date),
      settlement,
    });
    people.push({
      profile,
      person,
      days,
      result,
      adjustments: mine,
      credit: { balanceMin, settleMin: chosen, rate, applied: result.credits },
    });
  }
  const blockers = o.userId ? [] : await findBlockers(ctx, month, data, people);
  return { month, data, people, blockers };
}

const DEFAULTS: Record<PayrollBlocker['kind'], string> = {
  pending_punches: 'Not counted, as if absent for that punch.',
  flagged_punches: 'Counted as accepted.',
  overtime_undecided: 'Not paid. Shown as pending overtime.',
  leave_undecided: 'Not applied. The days stay as recorded.',
  regularisations_undecided: 'Not applied.',
  open_sessions: 'Closed automatically at the end of the scheduled day.',
};

/** What is still open in the month (PRD 4.13.2), with the default if the owner finalises anyway. */
async function findBlockers(
  ctx: Ctx,
  month: string,
  data: DayData,
  people: PersonCalc[],
): Promise<PayrollBlocker[]> {
  const from = monthStart(month);
  const to = monthEnd(month);
  const ids = jsonList(people.map((p) => p.profile.user_id));
  const [punches, leave, regs] = await Promise.all([
    ctx.db.all<{ id: string; user_id: string; work_date: string; status: string }>(
      `SELECT id, user_id, work_date, status FROM punches
        WHERE org_id = ?org AND work_date BETWEEN ? AND ? AND user_id IN (SELECT value FROM json_each(?))
          AND (status = 'pending' OR (status = 'flagged' AND reviewed_at IS NULL))
        ORDER BY work_date, effective_ts`,
      from,
      to,
      ids,
    ),
    ctx.db.all<{ id: string; user_id: string; from_date: string }>(
      `SELECT id, user_id, from_date FROM leave_requests
        WHERE org_id = ?org AND status = 'pending' AND from_date <= ? AND to_date >= ?
          AND user_id IN (SELECT value FROM json_each(?)) ORDER BY from_date`,
      to,
      from,
      ids,
    ),
    ctx.db.all<{ id: string; user_id: string; work_date: string }>(
      `SELECT id, user_id, work_date FROM regularisations
        WHERE org_id = ?org AND status = 'pending' AND work_date BETWEEN ? AND ?
          AND user_id IN (SELECT value FROM json_each(?)) ORDER BY work_date`,
      from,
      to,
      ids,
    ),
  ]);
  const brief = (userId: string) => {
    const p = data.people.get(userId);
    return personBrief({
      id: userId,
      name: p?.name ?? '',
      designation: p?.designation ?? null,
      phone_e164: p?.phone_e164 ?? null,
    });
  };
  const item = (userId: string, workDate: string | null, refId: string) => ({
    user: brief(userId),
    workDate,
    refId,
  });
  const otItems: PayrollBlocker['items'] = [];
  const openItems: PayrollBlocker['items'] = [];
  for (const p of people) {
    for (const c of p.days) {
      if (c.otStatus === 'pending')
        otItems.push(item(p.profile.user_id, c.date, dayKey(p.profile.user_id, c.date)));
      if (c.result.status === 'OPEN')
        openItems.push(item(p.profile.user_id, c.date, dayKey(p.profile.user_id, c.date)));
    }
  }
  const lists: Record<PayrollBlocker['kind'], PayrollBlocker['items']> = {
    pending_punches: punches
      .filter((x) => x.status === 'pending')
      .map((x) => item(x.user_id, x.work_date, x.id)),
    flagged_punches: punches
      .filter((x) => x.status === 'flagged')
      .map((x) => item(x.user_id, x.work_date, x.id)),
    overtime_undecided: otItems,
    leave_undecided: leave.map((x) => item(x.user_id, x.from_date, x.id)),
    regularisations_undecided: regs.map((x) => item(x.user_id, x.work_date, x.id)),
    open_sessions: openItems,
  };
  return (Object.keys(lists) as PayrollBlocker['kind'][])
    .filter((kind) => lists[kind].length > 0)
    .map((kind) => ({
      kind,
      count: lists[kind].length,
      defaultAction: DEFAULTS[kind],
      items: lists[kind],
    }));
}
