/**
 * Read models for the owner's People screens (PRD 5.2, 9.4): `StaffRow` for the list and
 * `StaffDetail` for one person. Owner: WP-3.
 *
 * Leave balances, the advance balance, today and the month totals are read straight from the
 * ledger and day tables written by WP-4 and WP-5 (sums only, no rules applied here).
 */
import {
  addDays,
  type ConsentKind,
  type DayStatus,
  type DayTag,
  type DayType,
  type Divisor,
  formatRupees,
  istDate,
  istMonth,
  type LeaveCode,
  type OrgSettings,
  type OtRate,
  type OtStatus,
  type SalaryType,
  type StaffDetail,
  type StaffRow,
  type UserStatus,
} from '@fs/contracts';
import { bool, json } from '../../db';
import { fail } from '../../lib/errors';
import { loadOrg } from '../../lib/settings';
import { type DeviceRow, deviceView } from '../../services/device';
import type { Ctx } from '../../services/ports';

export interface StaffBase {
  id: string;
  name: string;
  phone_e164: string | null;
  role: 'staff' | 'manager';
  status: UserStatus;
  lang: 'en' | 'gu';
  exited_at: number | null;
  permissions_json: string | null;
  designation: string;
  join_date: string;
  exit_date: string | null;
  exit_reason: string | null;
  employee_code: string | null;
  default_template_id: string;
  week_off_dow: number | null;
  selfie_required: number | null;
  strong_mode: number;
  divisor_override: Divisor | null;
  ot_rate_override_json: string | null;
  device_state: 'none' | 'pending' | 'approved';
}

const BASE_SELECT = `SELECT u.id, u.name, u.phone_e164, u.role, u.status, u.lang, u.exited_at, u.permissions_json,
        p.designation, p.join_date, p.exit_date, p.exit_reason, p.employee_code, p.default_template_id,
        p.week_off_dow, p.selfie_required, p.strong_mode, p.divisor_override, p.ot_rate_override_json,
        (SELECT CASE WHEN SUM(d.status = 'approved') > 0 THEN 'approved'
                     WHEN SUM(d.status = 'pending') > 0 THEN 'pending' ELSE 'none' END
           FROM devices d WHERE d.org_id = u.org_id AND d.user_id = u.id) AS device_state
   FROM users u JOIN staff_profiles p ON p.user_id = u.id`;

/** One staff member or manager of this org, or 404 (also for other orgs' ids). */
export async function staffBase(ctx: Ctx, id: string): Promise<StaffBase> {
  const row = await ctx.db.first<StaffBase>(
    `${BASE_SELECT} WHERE u.org_id = ?org AND u.id = ? AND u.role IN ('staff', 'manager')`,
    id,
  );
  if (!row) fail('NOT_FOUND');
  return row;
}

export function staffRow(b: StaffBase): StaffRow {
  return {
    id: b.id,
    name: b.name,
    phone: b.phone_e164,
    designation: b.designation,
    status: b.status,
    deviceState: b.device_state,
    joinDate: b.join_date,
    exitDate: b.exit_date,
    employeeCode: b.employee_code,
  };
}

export async function listStaff(
  ctx: Ctx,
  opts: { status?: 'active' | 'invited' | 'exited' | 'all' | undefined; q?: string | undefined },
): Promise<StaffRow[]> {
  const where: string[] = ['u.org_id = ?org', "u.role IN ('staff', 'manager')"];
  const params: string[] = [];
  const status = opts.status;
  if (status === 'active' || status === 'invited' || status === 'exited') {
    where.push('u.status = ?');
    params.push(status);
  } else if (status !== 'all') {
    where.push("u.status <> 'exited'");
  }
  const q = opts.q?.trim();
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    const digits = q.replace(/\D/g, '');
    where.push(
      "(u.name LIKE ? ESCAPE '\\' OR p.employee_code LIKE ? ESCAPE '\\' OR u.phone_e164 LIKE ?)",
    );
    params.push(like, like, digits.length >= 3 ? `%${digits}%` : '\u0000');
  }
  const rows = await ctx.db.all<StaffBase>(
    `${BASE_SELECT} WHERE ${where.join(' AND ')} ORDER BY u.status = 'exited', u.name COLLATE NOCASE`,
    ...params,
  );
  return rows.map(staffRow);
}

interface SalaryRow {
  salary_type: SalaryType;
  amount_paise: number;
  effective_from: string;
  created_at: number;
}

const salaryView = (r: SalaryRow) => ({
  type: r.salary_type,
  amountPaise: r.amount_paise,
  effectiveFrom: r.effective_from,
  createdAt: r.created_at,
});

/** The salary in effect on `date`: the latest row starting on or before it, else the first. */
export function salaryOn(rows: SalaryRow[], date: string): SalaryRow | null {
  let pick: SalaryRow | null = null;
  for (const r of rows) if (r.effective_from <= date) pick = r;
  return pick ?? rows[0] ?? null;
}

/** "₹11,000 is below the minimum wage you set (₹13,325 a month). You can still save." */
export function minimumWageWarning(
  settings: OrgSettings,
  salary: { type: SalaryType; amountPaise: number } | null,
): string | null {
  const mw = settings.pay.minimumWage;
  if (!mw.enabled || mw.amountPaise === null || !salary) return null;
  const monthly = (type: SalaryType, paise: number) => (type === 'daily' ? paise * 26 : paise);
  if (monthly(salary.type, salary.amountPaise) >= monthly(mw.basis, mw.amountPaise)) return null;
  const amount = formatRupees(salary.amountPaise, { whole: true });
  const min = formatRupees(mw.amountPaise, { whole: true });
  return `${amount} is below the minimum wage you set (${min} a ${mw.basis === 'daily' ? 'day' : 'month'}). You can still save.`;
}

interface DayRow {
  work_date: string;
  day_type: DayType;
  status: DayStatus;
  leave_type_code: LeaveCode | null;
  template_name: string | null;
  scheduled_min: number;
  worked_min: number;
  late_min: number;
  late_billable_min: number;
  early_min: number;
  early_billable_min: number;
  undertime_min: number;
  ot_preapproved_min: number;
  ot_candidate_min: number;
  ot_approved_min: number;
  ot_status: OtStatus;
  offday_credit: number;
  tags_json: string;
  locked: number;
  holiday_name: string | null;
  first_in: number | null;
  last_out: number | null;
}

interface TotalsRow {
  present: number | null;
  half: number | null;
  absent: number | null;
  leave: number | null;
  lop: number | null;
  week_off: number | null;
  holiday: number | null;
  worked: number | null;
  late: number | null;
  late_b: number | null;
  early_b: number | null;
  ot_a: number | null;
  ot_p: number | null;
}

function monthBounds(month: string): [string, string] {
  return [`${month}-01`, `${month}-31`];
}

export async function loadStaffDetail(ctx: Ctx, id: string): Promise<StaffDetail> {
  const base = await staffBase(ctx, id);
  const now = ctx.now();
  const today = istDate(now);
  const [from, to] = monthBounds(istMonth(now));

  const [
    { settings },
    salaries,
    devices,
    invite,
    consents,
    leaveTypes,
    coExpiry,
    advance,
    day,
    totals,
  ] = await Promise.all([
    loadOrg(ctx),
    ctx.db.all<SalaryRow>(
      `SELECT salary_type, amount_paise, effective_from, created_at FROM salary_history
        WHERE org_id = ?org AND user_id = ? ORDER BY effective_from`,
      id,
    ),
    ctx.db.all<DeviceRow>(
      'SELECT * FROM devices WHERE org_id = ?org AND user_id = ? ORDER BY requested_at DESC LIMIT 10',
      id,
    ),
    ctx.db.first<{ expires_at: number; used_at: number | null; revoked_at: number | null }>(
      `SELECT expires_at, used_at, revoked_at FROM invites WHERE org_id = ?org AND user_id = ?
        ORDER BY created_at DESC LIMIT 1`,
      id,
    ),
    ctx.db.all<{
      kind: ConsentKind;
      version: string;
      lang: string;
      accepted_at: number;
      withdrawn_at: number | null;
    }>(
      `SELECT kind, version, lang, accepted_at, withdrawn_at FROM consents
        WHERE org_id = ?org AND user_id = ? ORDER BY accepted_at DESC`,
      id,
    ),
    ctx.db.all<{
      id: string;
      code: LeaveCode;
      name: string;
      paid: number;
      usable_after_days: number;
      balance: number;
      pending: number;
    }>(
      `SELECT t.id, t.code, t.name, t.paid, t.usable_after_days,
              COALESCE((SELECT SUM(l.days) FROM leave_ledger l
                         WHERE l.org_id = t.org_id AND l.user_id = ? AND l.leave_type_id = t.id), 0) AS balance,
              COALESCE((SELECT SUM(r.days_paid) FROM leave_requests r
                         WHERE r.org_id = t.org_id AND r.user_id = ? AND r.leave_type_id = t.id
                           AND r.status = 'pending'), 0) AS pending
         FROM leave_types t
        WHERE t.org_id = ?org AND t.active = 1 AND t.code <> 'LOP'
        ORDER BY CASE t.code WHEN 'CL' THEN 1 WHEN 'SL' THEN 2 WHEN 'EL' THEN 3 ELSE 4 END`,
      id,
      id,
    ),
    ctx.db.first<{ expires_on: string; days: number }>(
      `SELECT l.expires_on, SUM(l.days) AS days FROM leave_ledger l
         JOIN leave_types t ON t.id = l.leave_type_id
        WHERE l.org_id = ?org AND l.user_id = ? AND t.code = 'CO' AND l.kind = 'credit'
          AND l.expires_on >= ?
        GROUP BY l.expires_on ORDER BY l.expires_on LIMIT 1`,
      id,
      today,
    ),
    ctx.db.first<{ given: number | null; recovered: number | null }>(
      `SELECT SUM(a.amount_paise) AS given,
              (SELECT SUM(r.recovered_paise) FROM advance_recoveries r
                WHERE r.org_id = ?org AND r.user_id = ? AND r.advance_id IN
                  (SELECT x.id FROM advances x WHERE x.org_id = ?org AND x.user_id = ? AND x.status = 'active')
              ) AS recovered
         FROM advances a WHERE a.org_id = ?org AND a.user_id = ? AND a.status = 'active'`,
      id,
      id,
      id,
    ),
    ctx.db.first<DayRow>(
      `SELECT d.work_date, d.day_type, d.status, d.leave_type_code, t.name AS template_name,
              d.scheduled_min, d.worked_min, d.late_min, d.late_billable_min, d.early_min,
              d.early_billable_min, d.undertime_min, d.ot_preapproved_min, d.ot_candidate_min,
              d.ot_approved_min, d.ot_status, d.offday_credit, d.tags_json, d.locked,
              (SELECT h.name FROM holidays h WHERE h.org_id = d.org_id AND h.date = d.work_date) AS holiday_name,
              (SELECT MIN(p.effective_ts) FROM punches p WHERE p.org_id = d.org_id AND p.user_id = d.user_id
                  AND p.work_date = d.work_date AND p.kind = 'in' AND p.status IN ('accepted', 'flagged')) AS first_in,
              (SELECT MAX(p.effective_ts) FROM punches p WHERE p.org_id = d.org_id AND p.user_id = d.user_id
                  AND p.work_date = d.work_date AND p.kind = 'out' AND p.status IN ('accepted', 'flagged')) AS last_out
         FROM attendance_days d LEFT JOIN shift_templates t ON t.id = d.template_id
        WHERE d.org_id = ?org AND d.user_id = ? AND d.work_date = ?`,
      id,
      today,
    ),
    ctx.db.first<TotalsRow>(
      `SELECT SUM(status = 'P') AS present, SUM(status = 'H') AS half, SUM(status = 'A') AS absent,
              SUM(status = 'L') AS leave, SUM(status = 'LOP') AS lop, SUM(status = 'WO') AS week_off,
              SUM(status = 'HO') AS holiday, SUM(worked_min) AS worked, SUM(late_min) AS late,
              SUM(late_billable_min) AS late_b, SUM(early_billable_min) AS early_b,
              SUM(ot_approved_min) AS ot_a,
              SUM(CASE WHEN ot_status = 'pending' THEN ot_candidate_min ELSE 0 END) AS ot_p
         FROM attendance_days WHERE org_id = ?org AND user_id = ? AND work_date BETWEEN ? AND ?`,
      id,
      from,
      to,
    ),
  ]);

  const current = salaryOn(salaries, today);
  const salary = current
    ? salaryView(current)
    : { type: 'monthly' as const, amountPaise: 0, effectiveFrom: base.join_date, createdAt: 0 };
  // Managers without the payroll permission see no salary figures (PRD 10.2).
  const canSeePay = ctx.user?.permissions.includes('payroll') ?? false;

  const inviteState = invite
    ? invite.used_at !== null
      ? ('used' as const)
      : invite.revoked_at !== null || invite.expires_at <= now
        ? ('expired' as const)
        : ('active' as const)
    : null;

  return {
    ...staffRow(base),
    lang: base.lang,
    salary: canSeePay ? salary : { ...salary, amountPaise: 0 },
    salaryHistory: canSeePay ? salaries.map(salaryView) : [],
    defaultTemplateId: base.default_template_id,
    weekOffDow: base.week_off_dow,
    selfieRequired: base.selfie_required === null ? null : bool(base.selfie_required),
    strongMode: bool(base.strong_mode),
    divisorOverride: base.divisor_override,
    otRateOverride: json<OtRate | null>(base.ot_rate_override_json, null),
    devices: devices.map(deviceView),
    leaveBalances: leaveTypes.map((t) => {
      const usableFrom =
        t.usable_after_days > 0 ? addDays(base.join_date, t.usable_after_days) : null;
      return {
        code: t.code,
        name: t.name,
        paid: bool(t.paid),
        balance: t.balance,
        pending: t.pending,
        nextExpiry:
          t.code === 'CO' && coExpiry ? { days: coExpiry.days, on: coExpiry.expires_on } : null,
        usableFrom: usableFrom && usableFrom > today ? usableFrom : null,
      };
    }),
    advanceBalancePaise: canSeePay
      ? Math.max(0, (advance?.given ?? 0) - (advance?.recovered ?? 0))
      : 0,
    invite: invite && inviteState ? { status: inviteState, expiresAt: invite.expires_at } : null,
    today: day
      ? {
          workDate: day.work_date,
          dayType: day.day_type,
          status: day.status,
          leaveCode: day.leave_type_code,
          templateName: day.template_name,
          scheduledMin: day.scheduled_min,
          workedMin: day.worked_min,
          lateMin: day.late_min,
          lateBillableMin: day.late_billable_min,
          earlyMin: day.early_min,
          earlyBillableMin: day.early_billable_min,
          undertimeMin: day.undertime_min,
          otPreapprovedMin: day.ot_preapproved_min,
          otCandidateMin: day.ot_candidate_min,
          otApprovedMin: day.ot_approved_min,
          otStatus: day.ot_status,
          offdayCredit: day.offday_credit,
          tags: json<DayTag[]>(day.tags_json, []),
          firstInTs: day.first_in,
          lastOutTs: day.last_out,
          locked: bool(day.locked),
          holidayName: day.holiday_name,
        }
      : null,
    monthTotals: {
      present: totals?.present ?? 0,
      half: totals?.half ?? 0,
      absent: totals?.absent ?? 0,
      leave: totals?.leave ?? 0,
      lop: totals?.lop ?? 0,
      weekOff: totals?.week_off ?? 0,
      holiday: totals?.holiday ?? 0,
      workedMin: totals?.worked ?? 0,
      lateMin: totals?.late ?? 0,
      lateBillableMin: totals?.late_b ?? 0,
      earlyBillableMin: totals?.early_b ?? 0,
      otApprovedMin: totals?.ot_a ?? 0,
      otPendingMin: totals?.ot_p ?? 0,
    },
    consents: consents.map((c) => ({
      kind: c.kind,
      version: c.version,
      lang: c.lang,
      acceptedAt: c.accepted_at,
      withdrawnAt: c.withdrawn_at,
    })),
    exitReason: base.exit_reason,
    minimumWageWarning: canSeePay
      ? minimumWageWarning(settings, current && salaryView(current))
      : null,
  };
}

/** `3 Aug` from `2026-08-03`. */
export function shortDate(date: string): string {
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const [, m, d] = date.split('-');
  return `${Number(d)} ${months[Number(m) - 1] ?? ''}`.trim();
}
