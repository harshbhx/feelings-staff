/**
 * DayService (PRD 7.2-7.8, 13.2): loads the inputs of person-days, calls `resolveSchedule` and
 * `computeDay` from @fs/engine, and stores `attendance_days`. Also the shared day and schedule view
 * mappers used by the staff and owner routes. Owner: WP-4.
 *
 * Bulk first: `loadDayData` reads everything for a set of people and a date range in a handful of
 * queries; `computeFrom` is then pure and cheap, so month views compute missing days on the fly.
 */
import {
  type AuditEntryView,
  addDays,
  type DayOverride,
  type DayPayLine,
  type DayResult,
  type DaySchedule,
  type DaySummary,
  DayTag,
  datesBetween,
  daysInMonth,
  floorToMinute,
  formatRupees,
  type HolidayRule,
  istTime,
  type LeaveCode,
  type LeaveOnDay,
  type MonthTotals,
  monthDates,
  type OrgSettings,
  type OtRate,
  type OtStatus,
  type OtWindow,
  type PersonBrief,
  type PersonPolicy,
  type PunchForCalc,
  type RosterOverrideRule,
  type ScheduleView,
  type TemplateRule,
  type TimeRules,
  type WorkedOffDayComp,
} from '@fs/contracts';
import { computeDay, creditsOn, resolveSchedule, timeRulesFromSettings } from '@fs/engine';
import { json } from '../db';
import { fail } from '../lib/errors';
import { loadOrg } from '../lib/settings';
import { ulid } from '../lib/ulid';
import { creditStmts } from './credit-entries';
import { legalPlan } from './credit-legal';
import type { DutyRow } from './duty';
import type { Ctx, DayService } from './ports';
import { syncAwayRows } from './presence-rows';
import type { PunchRow } from './punch';

// ---- Rows ------------------------------------------------------------------------------------

export interface ProfileRow {
  user_id: string;
  name: string;
  role: 'owner' | 'manager' | 'staff';
  status: 'invited' | 'active' | 'suspended' | 'exited';
  phone_e164: string | null;
  designation: string;
  employee_code: string | null;
  join_date: string;
  exit_date: string | null;
  default_template_id: string;
  week_off_dow: number | null;
  selfie_required: number | null;
  strong_mode: number;
  enrolled_photo_key: string | null;
  divisor_override: 'calendar' | 'fixed30' | 'fixed26' | 'working' | null;
  ot_rate_override_json: string | null;
  /** Time credits: null follows the salon, 0 excludes this person (PRD 7.17.1). */
  time_credits: number | null;
  /** Presence: null follows the salon, 0 excludes this person (PRD 4.18.7). */
  presence_enabled: number | null;
}

export interface TemplateRow {
  id: string;
  name: string;
  segments_json: string;
  break_min: number;
  active: number;
  sort: number;
}

export interface AttendanceDayRow {
  user_id: string;
  work_date: string;
  day_type: DaySummary['dayType'];
  template_id: string | null;
  scheduled_min: number;
  worked_min: number;
  /** Every worked minute of the day, inside the shift or not (`DayResult.totalMin`). */
  total_min: number;
  break_min: number;
  late_min: number;
  late_billable_min: number;
  early_min: number;
  early_billable_min: number;
  overbreak_min: number;
  makeup_min: number;
  undertime_min: number;
  ot_preapproved_min: number;
  ot_candidate_min: number;
  ot_approved_min: number;
  ot_status: OtStatus;
  status: DaySummary['status'];
  leave_type_code: LeaveCode | null;
  offday_credit: number;
  tags_json: string;
  override_json: string | null;
  engine_version: string;
  computed_at: number;
  locked: number;
  payroll_run_id: string | null;
}

export interface LeaveRequestRow {
  id: string;
  user_id: string;
  leave_type_id: string;
  from_date: string;
  to_date: string;
  half: 'none' | 'first' | 'second';
  days_paid: number;
  days_unpaid: number;
  reason: string | null;
  blackout_hit: number;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  decided_by: string | null;
  decided_at: number | null;
  decision_note: string | null;
  cancelled_at: number | null;
  created_at: number;
}

export interface LeaveTypeRow {
  id: string;
  code: LeaveCode;
  name: string;
  paid: number;
  annual_quota: number | null;
  accrual: 'annual' | 'earned' | 'event' | 'none';
  usable_after_days: number;
  notice_days: number;
  backdate_days: number;
  expiry_days: number | null;
  active: number;
}

interface PreapprovalRow {
  id: string;
  user_id: string;
  work_date: string;
  start_ts: number;
  end_ts: number;
}

export interface OtDecisionRow {
  id: string;
  user_id: string;
  work_date: string;
  candidate_min: number;
  approved_min: number;
  decision: 'approved' | 'partial' | 'rejected' | 'auto';
  decided_by: string | null;
  decided_at: number;
}

interface RosterJoinRow {
  user_id: string;
  work_date: string;
  kind: 'template' | 'week_off' | 'no_shift';
  template_id: string | null;
}

interface HolidayRow {
  date: string;
  name: string;
  paid: number;
  worked_comp: WorkedOffDayComp;
}

// ---- Small mappers -------------------------------------------------------------------------------

/** Display brief of a person (PersonBrief). */
export function personBrief(row: {
  user_id?: string;
  id?: string;
  name: string;
  designation?: string | null;
  phone_e164?: string | null;
}): PersonBrief {
  return {
    id: (row.user_id ?? row.id) as string,
    name: row.name,
    designation: row.designation ?? null,
    phone: row.phone_e164 ?? null,
  };
}

export function templateRule(row: TemplateRow): TemplateRule {
  return {
    id: row.id,
    name: row.name,
    segments: json(row.segments_json, [] as TemplateRule['segments']),
    breakMin: row.break_min,
  };
}

export const dayKey = (userId: string, date: string) => `${userId}|${date}`;

/** JSON list binding for `IN (SELECT value FROM json_each(?))`. */
export const jsonList = (ids: readonly string[]) => JSON.stringify(ids);

// ---- Bulk loading --------------------------------------------------------------------------------

export interface DayData {
  settings: OrgSettings;
  /** The owner's display name for staff copy ("Urmi"). */
  ownerName: string;
  rules: TimeRules;
  from: string;
  to: string;
  templates: Map<string, TemplateRow>;
  people: Map<string, ProfileRow>;
  holidays: HolidayRule[];
  holidayByDate: Map<string, HolidayRule>;
  roster: Map<string, RosterOverrideRule[]>;
  punches: Map<string, PunchRow[]>;
  leaves: Map<string, LeaveRequestRow[]>;
  leaveTypes: Map<string, LeaveTypeRow>;
  duties: Map<string, DutyRow[]>;
  preapprovals: Map<string, PreapprovalRow[]>;
  stored: Map<string, AttendanceDayRow>;
  otDecisions: Map<string, OtDecisionRow>;
  /** Cache of counted leave dates per request id. */
  leaveDates: Map<string, string[]>;
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
}

/**
 * Load every input for `userIds` (null = everyone with a staff profile) from `from` to `to`.
 * Approved leave requests overlapping the range widen the calendar so paid/unpaid parts resolve.
 */
export async function loadDayData(
  ctx: Ctx,
  userIds: readonly string[] | null,
  from: string,
  to: string,
  settings?: OrgSettings,
): Promise<DayData> {
  const { org, settings: loaded } = await loadOrg(ctx);
  const s = settings ?? loaded;
  const who = userIds ? jsonList(userIds) : null;
  // The user filter, when present, always comes before the other placeholders of a statement.
  const userFilter = (col: string) => (who ? `AND ${col} IN (SELECT value FROM json_each(?))` : '');
  const bind = (...rest: (string | number)[]) => (who ? [who, ...rest] : rest);

  const [templates, people, leaves, leaveTypes] = await Promise.all([
    ctx.db.all<TemplateRow>(
      'SELECT id, name, segments_json, break_min, active, sort FROM shift_templates WHERE org_id = ?org',
    ),
    ctx.db.all<ProfileRow>(
      `SELECT p.user_id, u.name, u.role, u.status, u.phone_e164, p.designation, p.employee_code, p.join_date,
              p.exit_date, p.default_template_id, p.week_off_dow, p.selfie_required, p.strong_mode,
              p.enrolled_photo_key, p.divisor_override, p.ot_rate_override_json, p.time_credits,
              p.presence_enabled
         FROM staff_profiles p JOIN users u ON u.id = p.user_id
        WHERE p.org_id = ?org ${userFilter('p.user_id')}`,
      ...bind(),
    ),
    ctx.db.all<LeaveRequestRow>(
      `SELECT * FROM leave_requests
        WHERE org_id = ?org ${userFilter('user_id')} AND status = 'approved'
          AND from_date <= ? AND to_date >= ?`,
      ...bind(to, from),
    ),
    ctx.db.all<LeaveTypeRow>('SELECT * FROM leave_types WHERE org_id = ?org'),
  ]);

  let calFrom = from;
  let calTo = to;
  for (const l of leaves) {
    if (l.from_date < calFrom) calFrom = l.from_date;
    if (l.to_date > calTo) calTo = l.to_date;
  }

  const [holidays, roster, punches, duties, preapprovals, stored, decisions] = await Promise.all([
    ctx.db.all<HolidayRow>(
      'SELECT date, name, paid, worked_comp FROM holidays WHERE org_id = ?org AND date BETWEEN ? AND ?',
      calFrom,
      calTo,
    ),
    ctx.db.all<RosterJoinRow>(
      `SELECT user_id, work_date, kind, template_id FROM roster_overrides
        WHERE org_id = ?org ${userFilter('user_id')} AND work_date BETWEEN ? AND ?`,
      ...bind(calFrom, calTo),
    ),
    ctx.db.all<PunchRow>(
      `SELECT * FROM punches WHERE org_id = ?org ${userFilter('user_id')} AND work_date BETWEEN ? AND ?
        ORDER BY effective_ts, id`,
      ...bind(from, to),
    ),
    ctx.db.all<DutyRow & { user_id: string }>(
      `SELECT d.*, s.user_id, st.lat AS site_lat, st.lng AS site_lng, st.radius_m AS site_radius_m,
              st.max_accuracy_m AS site_max_accuracy_m
         FROM offsite_duties d JOIN offsite_duty_staff s ON s.duty_id = d.id
         LEFT JOIN sites st ON st.id = d.site_id
        WHERE d.org_id = ?org ${userFilter('s.user_id')} AND d.cancelled_at IS NULL
          AND d.work_date BETWEEN ? AND ?`,
      ...bind(from, to),
    ),
    ctx.db.all<PreapprovalRow>(
      `SELECT id, user_id, work_date, start_ts, end_ts FROM ot_preapprovals
        WHERE org_id = ?org ${userFilter('user_id')} AND work_date BETWEEN ? AND ?`,
      ...bind(from, to),
    ),
    ctx.db.all<AttendanceDayRow>(
      `SELECT * FROM attendance_days WHERE org_id = ?org ${userFilter('user_id')} AND work_date BETWEEN ? AND ?`,
      ...bind(from, to),
    ),
    ctx.db.all<OtDecisionRow>(
      `SELECT id, user_id, work_date, candidate_min, approved_min, decision, decided_by, decided_at FROM ot_decisions
        WHERE org_id = ?org ${userFilter('user_id')} AND work_date BETWEEN ? AND ?
        ORDER BY decided_at`,
      ...bind(from, to),
    ),
  ]);

  const templateMap = new Map(templates.map((t) => [t.id, t]));
  const holidayRules: HolidayRule[] = holidays.map((h) => ({
    date: h.date,
    name: h.name,
    paid: h.paid === 1,
    workedComp: h.worked_comp,
  }));
  const data: DayData = {
    settings: s,
    ownerName: org.owner_display_name,
    rules: timeRulesFromSettings(s),
    from,
    to,
    templates: templateMap,
    people: new Map(people.map((p) => [p.user_id, p])),
    holidays: holidayRules,
    holidayByDate: new Map(holidayRules.map((h) => [h.date, h])),
    roster: new Map(),
    punches: new Map(),
    leaves: new Map(),
    leaveTypes: new Map(leaveTypes.map((t) => [t.id, t])),
    duties: new Map(),
    preapprovals: new Map(),
    stored: new Map(stored.map((r) => [dayKey(r.user_id, r.work_date), r])),
    otDecisions: new Map(),
    leaveDates: new Map(),
  };
  for (const r of roster) {
    const t = r.template_id ? templateMap.get(r.template_id) : undefined;
    push(data.roster, r.user_id, {
      date: r.work_date,
      kind: r.kind,
      template: t ? templateRule(t) : null,
    });
  }
  for (const p of punches) push(data.punches, dayKey(p.user_id, p.work_date), p);
  for (const l of leaves) push(data.leaves, l.user_id, l);
  for (const d of duties) push(data.duties, d.user_id, d);
  for (const p of preapprovals) push(data.preapprovals, p.user_id, p);
  for (const d of decisions) data.otDecisions.set(dayKey(d.user_id, d.work_date), d);
  return data;
}

// ---- Computing ---------------------------------------------------------------------------------

export function personPolicy(data: DayData, p: ProfileRow): PersonPolicy {
  const t = data.templates.get(p.default_template_id);
  if (!t) throw new Error(`Template ${p.default_template_id} missing`);
  return {
    userId: p.user_id,
    joinDate: p.join_date,
    exitDate: p.exit_date,
    weekOffDow: p.week_off_dow,
    defaultTemplate: templateRule(t),
  };
}

export function scheduleFrom(data: DayData, userId: string, date: string): DaySchedule | null {
  const p = data.people.get(userId);
  if (!p) return null;
  return resolveSchedule(personPolicy(data, p), date, {
    holidays: data.holidays,
    rosterOverrides: data.roster.get(userId) ?? [],
  });
}

/** Dates of a leave request that count (working days, PRD 4.9 step 2), in order. */
export function countedLeaveDates(data: DayData, req: LeaveRequestRow): string[] {
  const cached = data.leaveDates.get(req.id);
  if (cached) return cached;
  const dates = datesBetween(req.from_date, req.to_date).filter(
    (d) => scheduleFrom(data, req.user_id, d)?.dayType === 'work',
  );
  data.leaveDates.set(req.id, dates);
  return dates;
}

/** Approved leave on a date: the paid part first, the rest unpaid (PRD 4.9, 7.8). */
export function leaveOnDay(data: DayData, userId: string, date: string): LeaveOnDay | null {
  for (const req of data.leaves.get(userId) ?? []) {
    if (date < req.from_date || date > req.to_date) continue;
    const idx = countedLeaveDates(data, req).indexOf(date);
    if (idx < 0) continue;
    const type = data.leaveTypes.get(req.leave_type_id);
    if (!type) continue;
    const paid = type.paid === 1 && idx < req.days_paid;
    return { code: paid ? type.code : 'LOP', paid, half: req.half, requestId: req.id };
  }
  return null;
}

export interface Computed {
  userId: string;
  date: string;
  schedule: DaySchedule;
  leave: LeaveOnDay | null;
  result: DayResult;
  override: DayOverride | null;
  otApprovedMin: number;
  otStatus: OtStatus;
  tags: DayTag[];
  locked: boolean;
  punches: PunchRow[];
  /** Time credits are on for this person on this date (PRD 7.17.1). */
  creditsOn: boolean;
}

export interface DayOverlay {
  /** Replace the punch list for the day (e.g. with a new punch that is not stored yet). */
  punches?: (rows: PunchRow[]) => PunchRow[];
  /** Replace the stored override (owner override in the same batch). */
  override?: DayOverride | null;
}

const COUNTED = new Set(['accepted', 'flagged']);
const TAG_ORDER = DayTag.options;

function windowsFor(data: DayData, userId: string, date: string): OtWindow[] {
  const out: OtWindow[] = [];
  for (const d of data.duties.get(userId) ?? []) {
    if (d.work_date === date && d.ot_preapproved === 1) {
      out.push({ startTs: d.start_ts, endTs: d.end_ts, source: 'duty', refId: d.id });
    }
  }
  for (const p of data.preapprovals.get(userId) ?? []) {
    if (p.work_date === date) {
      out.push({ startTs: p.start_ts, endTs: p.end_ts, source: 'preapproval', refId: p.id });
    }
  }
  return out;
}

/** `credits_on(person, date)` (PRD 7.17.1): the salon switch, its start date and the person's exclusion. */
export function creditsEnabledFor(
  settings: OrgSettings,
  profile: Pick<ProfileRow, 'time_credits'>,
  date: string,
): boolean {
  return creditsOn(
    settings.timeCredits,
    profile.time_credits === null ? null : profile.time_credits === 1,
    date,
  );
}

/** Compute one person-day from loaded data. Null when the person has no staff profile. */
export function computeFrom(
  data: DayData,
  userId: string,
  date: string,
  overlay: DayOverlay = {},
): Computed | null {
  const schedule = scheduleFrom(data, userId, date);
  if (!schedule) return null;
  const key = dayKey(userId, date);
  const stored = data.stored.get(key) ?? null;
  const rows = overlay.punches
    ? overlay.punches(data.punches.get(key) ?? [])
    : (data.punches.get(key) ?? []);
  const counted = rows.filter((p) => COUNTED.has(p.status));
  const punches: PunchForCalc[] = counted.map((p) => ({
    id: p.id,
    kind: p.kind,
    effectiveTs: floorToMinute(p.effective_ts),
    status: p.status,
    source: p.source,
    offsiteDutyId: p.offsite_duty_id,
  }));
  const override =
    overlay.override !== undefined
      ? overlay.override
      : json<DayOverride | null>(stored?.override_json ?? null, null);
  const leave = leaveOnDay(data, userId, date);
  const profile = data.people.get(userId);
  const creditsOnDay = profile ? creditsEnabledFor(data.settings, profile, date) : false;
  const result = computeDay({
    schedule,
    punches,
    preapprovals: windowsFor(data, userId, date),
    leave,
    rules: creditsOnDay ? { ...data.rules, credits: true } : data.rules,
    override,
  });

  const decision = data.otDecisions.get(key);
  let otStatus: OtStatus;
  let decided = 0;
  if (decision) {
    decided = Math.min(decision.approved_min, result.otCandidateMin);
    otStatus = decision.decision === 'auto' ? 'approved' : decision.decision;
  } else if (result.otCandidateMin > 0) otStatus = 'pending';
  else if (result.otPreapprovedMin > 0) otStatus = 'approved';
  else otStatus = 'none';

  const tags = new Set<DayTag>(result.tags);
  if (counted.some((p) => p.offsite_duty_id !== null || p.place_name !== null)) tags.add('offsite');
  if (counted.some((p) => p.source === 'offline')) tags.add('offline');
  if (counted.some((p) => p.source === 'auto')) tags.add('auto_closed');
  if (override || rows.some((p) => p.source === 'owner' || p.replaces_punch_id !== null)) {
    tags.add('edited');
  }
  if (rows.some((p) => p.status === 'flagged')) tags.add('flagged');
  if (rows.some((p) => p.status === 'pending')) tags.add('pending');

  return {
    userId,
    date,
    schedule,
    leave,
    result,
    override,
    otApprovedMin: result.otPreapprovedMin + decided,
    otStatus,
    tags: TAG_ORDER.filter((t) => tags.has(t)),
    locked: stored?.locked === 1,
    punches: rows,
    creditsOn: creditsOnDay,
  };
}

/** Upsert of the computed day. Locked days (finalised payroll) are never changed. */
export function upsertDayStmt(ctx: Ctx, c: Computed, now: number): D1PreparedStatement {
  const r = c.result;
  return ctx.db.stmt(
    `INSERT INTO attendance_days (org_id, user_id, work_date, day_type, template_id, scheduled_min, worked_min, total_min,
        break_min, late_min, late_billable_min, early_min, early_billable_min, overbreak_min, makeup_min,
        undertime_min, ot_preapproved_min, ot_candidate_min, ot_approved_min, ot_status, status,
        leave_type_code, offday_credit, tags_json, override_json, engine_version, computed_at, locked)
     VALUES (?org, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT (user_id, work_date) DO UPDATE SET
        day_type = excluded.day_type, template_id = excluded.template_id,
        scheduled_min = excluded.scheduled_min, worked_min = excluded.worked_min, total_min = excluded.total_min,
        break_min = excluded.break_min, late_min = excluded.late_min,
        late_billable_min = excluded.late_billable_min, early_min = excluded.early_min,
        early_billable_min = excluded.early_billable_min, overbreak_min = excluded.overbreak_min,
        makeup_min = excluded.makeup_min, undertime_min = excluded.undertime_min,
        ot_preapproved_min = excluded.ot_preapproved_min, ot_candidate_min = excluded.ot_candidate_min,
        ot_approved_min = excluded.ot_approved_min, ot_status = excluded.ot_status,
        status = excluded.status, leave_type_code = excluded.leave_type_code,
        offday_credit = excluded.offday_credit, tags_json = excluded.tags_json,
        override_json = excluded.override_json, engine_version = excluded.engine_version,
        computed_at = excluded.computed_at
      WHERE attendance_days.locked = 0 AND attendance_days.org_id = excluded.org_id`,
    c.userId,
    c.date,
    r.dayType,
    r.templateId,
    r.scheduledMin,
    r.workedMin,
    r.totalMin ?? r.workedMin,
    r.breakMin,
    r.lateMin,
    r.lateBillableMin,
    r.earlyMin,
    r.earlyBillableMin,
    r.overbreakMin,
    r.makeupMin,
    r.undertimeMin,
    r.otPreapprovedMin,
    r.otCandidateMin,
    c.otApprovedMin,
    c.otStatus,
    r.status,
    r.leaveCode,
    r.offdayCredit,
    JSON.stringify(c.tags),
    c.override ? JSON.stringify(c.override) : null,
    r.version,
    now,
  );
}

export interface DayPlan {
  computed: Computed;
  data: DayData;
  /** The day upsert and its comp-off credit; empty for a locked day. */
  stmts: D1PreparedStatement[];
}

/** Comp-off days earned on a week off or holiday (PRD 7.7, 7.8): replaced on every recompute. */
export function compOffStmts(ctx: Ctx, data: DayData, c: Computed): D1PreparedStatement[] {
  const co = [...data.leaveTypes.values()].find((t) => t.code === 'CO' && t.active === 1);
  if (!co) return [];
  const ref = dayKey(c.userId, c.date);
  const out = [
    ctx.db.stmt(
      "DELETE FROM leave_ledger WHERE org_id = ?org AND user_id = ? AND ref_type = 'comp_off_day' AND ref_id = ?",
      c.userId,
      ref,
    ),
  ];
  const credit = c.result.offdayCredit;
  const comp =
    c.schedule.dayType === 'WO'
      ? data.settings.pay.weekOffWorked === 'comp_off'
      : c.schedule.dayType === 'HO'
        ? c.schedule.holiday?.workedComp !== 'extra_pay'
        : false;
  if (credit > 0 && comp) {
    out.push(
      ctx.db.insert('leave_ledger', {
        id: ulid(ctx.now()),
        user_id: c.userId,
        leave_type_id: co.id,
        entry_date: c.date,
        kind: 'credit',
        days: credit,
        ref_type: 'comp_off_day',
        ref_id: ref,
        expires_on: addDays(c.date, data.settings.leave.compOffExpiryDays),
        note: c.schedule.dayType === 'WO' ? 'Worked on a week off' : 'Worked on a holiday',
        created_by: 'system',
        created_at: ctx.now(),
      }),
    );
  }
  return out;
}

/** Compute a day (with an optional overlay) and prepare its upsert, for a caller's batch. */
export async function planDay(
  ctx: Ctx,
  userId: string,
  date: string,
  overlay: DayOverlay = {},
  data?: DayData,
): Promise<DayPlan> {
  const d = data ?? (await loadDayData(ctx, [userId], date, date));
  const computed = computeFrom(d, userId, date, overlay);
  if (!computed) return fail('NOT_FOUND', 'This person has no staff profile.');
  return {
    computed,
    data: d,
    stmts: computed.locked ? [] : await dayStmts(ctx, d, computed),
  };
}

/** The day row, its comp-off credit and its Time credits entries (PRD 7.17.2), for one batch. */
export async function dayStmts(
  ctx: Ctx,
  data: DayData,
  c: Computed,
): Promise<D1PreparedStatement[]> {
  const decision = data.otDecisions.get(dayKey(c.userId, c.date));
  const profile = data.people.get(c.userId);
  const legalOn = c.creditsOn && data.settings.timeCredits.legalOt2x;
  const legal = legalOn
    ? await legalPlan(
        ctx,
        c.userId,
        {
          date: c.date,
          totalMin: c.result.totalMin ?? c.result.workedMin,
          otApprovedMin: c.otApprovedMin,
        },
        (d) => (profile ? creditsEnabledFor(data.settings, profile, d) : false),
      )
    : { legalMin: 0, stmts: [] };
  // Presence first: it closes and re-clips away intervals, which the Time credits entries read.
  const awayMin = await syncAwayRows(ctx, c, {
    breakPunches: data.settings.attendance.breakPunches,
  });
  return [
    upsertDayStmt(ctx, c, ctx.now()),
    ctx.db.stmt(
      'UPDATE attendance_days SET away_min = ? WHERE org_id = ?org AND user_id = ? AND work_date = ?',
      awayMin,
      c.userId,
      c.date,
    ),
    ...compOffStmts(ctx, data, c),
    ...(await creditStmts(ctx, c, {
      otSourceId: decision?.id ?? windowsFor(data, c.userId, c.date)[0]?.refId ?? null,
      otConfirmedBy: decision?.decided_by ?? null,
      legalOtMin: legal.legalMin,
    })),
    ...legal.stmts,
  ];
}

/** DayService with a `plan` step so the punch pipeline can commit the day in its own batch. */
export interface PlanningDayService extends DayService {
  plan: typeof planDay;
}

export function isPlanningDayService(s: DayService): s is PlanningDayService {
  return typeof (s as Partial<PlanningDayService>).plan === 'function';
}

export function createDayService(): PlanningDayService {
  return {
    plan: planDay,
    async recompute(ctx, userId, date) {
      const p = await planDay(ctx, userId, date);
      await ctx.db.batch(p.stmts);
      return p.computed.result;
    },
  };
}

/**
 * Recompute through the port (so tests can swap it), returning the stored summary inputs.
 * Use after a batch that changed punches of the day.
 */
export async function recomputeDay(ctx: Ctx, userId: string, date: string): Promise<DayResult> {
  return ctx.services.days.recompute(ctx, userId, date);
}

// ---- Views ------------------------------------------------------------------------------------

function firstLast(punches: PunchRow[]): { firstInTs: number | null; lastOutTs: number | null } {
  let firstInTs: number | null = null;
  let lastOutTs: number | null = null;
  for (const p of punches) {
    if (!COUNTED.has(p.status)) continue;
    if (p.kind === 'in' && (firstInTs === null || p.effective_ts < firstInTs)) {
      firstInTs = p.effective_ts;
    }
    if (p.kind === 'out' && (lastOutTs === null || p.effective_ts > lastOutTs)) {
      lastOutTs = p.effective_ts;
    }
  }
  return { firstInTs, lastOutTs };
}

function templateName(data: DayData, id: string | null): string | null {
  return id ? (data.templates.get(id)?.name ?? null) : null;
}

/** DaySummary from a computed day. */
export function summaryFromComputed(data: DayData, c: Computed): DaySummary {
  const r = c.result;
  return {
    workDate: c.date,
    dayType: r.dayType,
    status: r.status,
    leaveCode: r.leaveCode,
    templateName: templateName(data, r.templateId),
    scheduledMin: r.scheduledMin,
    workedMin: r.workedMin,
    lateMin: r.lateMin,
    lateBillableMin: r.lateBillableMin,
    earlyMin: r.earlyMin,
    earlyBillableMin: r.earlyBillableMin,
    undertimeMin: r.undertimeMin,
    otPreapprovedMin: r.otPreapprovedMin,
    otCandidateMin: r.otCandidateMin,
    otApprovedMin: c.otApprovedMin,
    otStatus: c.otStatus,
    offdayCredit: r.offdayCredit,
    tags: c.tags,
    firstInTs: r.firstInTs,
    lastOutTs: r.lastOutTs,
    locked: c.locked,
    holidayName: c.schedule.holiday?.name ?? null,
  };
}

/** DaySummary from a stored attendance_days row (what payroll reads, S-11.1). */
export function summaryFromRow(data: DayData, row: AttendanceDayRow): DaySummary {
  const { firstInTs, lastOutTs } = firstLast(
    data.punches.get(dayKey(row.user_id, row.work_date)) ?? [],
  );
  return {
    workDate: row.work_date,
    dayType: row.day_type,
    status: row.status,
    leaveCode: row.leave_type_code,
    templateName: templateName(data, row.template_id),
    scheduledMin: row.scheduled_min,
    workedMin: row.worked_min,
    lateMin: row.late_min,
    lateBillableMin: row.late_billable_min,
    earlyMin: row.early_min,
    earlyBillableMin: row.early_billable_min,
    undertimeMin: row.undertime_min,
    otPreapprovedMin: row.ot_preapproved_min,
    otCandidateMin: row.ot_candidate_min,
    otApprovedMin: row.ot_approved_min,
    otStatus: row.ot_status,
    offdayCredit: row.offday_credit,
    tags: json<DayTag[]>(row.tags_json, []),
    firstInTs,
    lastOutTs,
    locked: row.locked === 1,
    holidayName: data.holidayByDate.get(row.work_date)?.name ?? null,
  };
}

/**
 * The summary to show for a day: the stored row when there is one, else computed on the fly
 * (not stored). Null when the person has no profile.
 */
export function daySummary(data: DayData, userId: string, date: string): DaySummary | null {
  const row = data.stored.get(dayKey(userId, date));
  if (row) return summaryFromRow(data, row);
  const c = computeFrom(data, userId, date);
  return c ? summaryFromComputed(data, c) : null;
}

export function scheduleView(data: DayData, c: Pick<Computed, 'schedule' | 'leave'>): ScheduleView {
  const s = c.schedule;
  const first = s.segments[0];
  const last = s.segments[s.segments.length - 1];
  const leaveType = c.leave
    ? [...data.leaveTypes.values()].find((t) => t.code === c.leave?.code)
    : undefined;
  return {
    dayType: s.dayType,
    templateId: s.templateId,
    templateName: s.templateName,
    segments: s.segments.map((x) => ({ start: istTime(x.startTs), end: istTime(x.endTs) })),
    breakMin: s.breakMin,
    scheduledMin: s.scheduledMin,
    startTs: first?.startTs ?? null,
    endTs: last?.endTs ?? null,
    holidayName: s.holiday?.name ?? null,
    leave: c.leave
      ? { code: c.leave.code, name: leaveType?.name ?? c.leave.code, half: c.leave.half }
      : null,
    nightHours: s.nightHours,
  };
}

// ---- Audit trail of a day ("Edited by Urmi") -----------------------------------------------------

interface AuditRow {
  id: string;
  category: AuditEntryView['category'];
  actor_type: AuditEntryView['actorType'];
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  before_json: string | null;
  after_json: string | null;
  reason: string | null;
  created_at: number;
}

export function auditView(r: AuditRow): AuditEntryView {
  return {
    id: r.id,
    category: r.category,
    actorType: r.actor_type,
    actorId: r.actor_id,
    actorName: r.actor_name,
    action: r.action,
    entity: r.entity,
    entityId: r.entity_id,
    before: json<unknown>(r.before_json, null),
    after: json<unknown>(r.after_json, null),
    reason: r.reason,
    createdAt: r.created_at,
  };
}

/** Entity id used for day-level audit rows (`entity = 'day'`). */
export const dayEntityId = (userId: string, date: string) => `${userId}|${date}`;

/**
 * Change rows that touched a person-day: day overrides and decisions on the day's punches.
 * `ownerEditsOnly` keeps the rows staff see as "Edited by Urmi".
 */
export async function dayAudit(
  ctx: Ctx,
  userId: string,
  date: string,
  punchIds: readonly string[],
  ownerEditsOnly = false,
): Promise<AuditEntryView[]> {
  const rows = await ctx.db.all<AuditRow>(
    `SELECT a.id, a.category, a.actor_type, a.actor_id, u.name AS actor_name, a.action, a.entity,
            a.entity_id, a.before_json, a.after_json, a.reason, a.created_at
       FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
      WHERE a.org_id = ?org AND a.category = 'change'
        AND ((a.entity = 'day' AND a.entity_id = ?)
          OR (a.entity = 'punch' AND a.entity_id IN (SELECT value FROM json_each(?))))
      ORDER BY a.created_at, a.id`,
    dayEntityId(userId, date),
    jsonList(punchIds),
  );
  const views = rows.map(auditView);
  return ownerEditsOnly
    ? views.filter((v) => v.actorId !== userId && v.actorType === 'user')
    : views;
}

// ---- Month totals and pay lines -------------------------------------------------------------------

/** Totals of a list of day summaries (PRD 5.1 Month, S-11.3). */
export function monthTotals(days: readonly DaySummary[]): MonthTotals {
  const t: MonthTotals = {
    present: 0,
    half: 0,
    absent: 0,
    leave: 0,
    lop: 0,
    weekOff: 0,
    holiday: 0,
    workedMin: 0,
    lateMin: 0,
    lateBillableMin: 0,
    earlyBillableMin: 0,
    otApprovedMin: 0,
    otPendingMin: 0,
  };
  for (const d of days) {
    if (d.status === 'P') t.present += 1;
    else if (d.status === 'H') t.half += 1;
    else if (d.status === 'A') t.absent += 1;
    else if (d.status === 'L') t.leave += 1;
    else if (d.status === 'LOP') t.lop += 1;
    else if (d.status === 'WO') t.weekOff += 1;
    else if (d.status === 'HO') t.holiday += 1;
    t.workedMin += d.workedMin;
    t.lateMin += d.lateMin;
    t.lateBillableMin += d.lateBillableMin;
    t.earlyBillableMin += d.earlyBillableMin;
    t.otApprovedMin += d.otApprovedMin;
    if (d.otStatus === 'pending') t.otPendingMin += d.otCandidateMin;
  }
  return t;
}

export interface SalaryOn {
  type: 'monthly' | 'daily';
  amountPaise: number;
}

export async function salaryOn(ctx: Ctx, userId: string, date: string): Promise<SalaryOn | null> {
  const r = await ctx.db.first<{ salary_type: 'monthly' | 'daily'; amount_paise: number }>(
    `SELECT salary_type, amount_paise FROM salary_history
      WHERE org_id = ?org AND user_id = ? AND effective_from <= ?
      ORDER BY effective_from DESC LIMIT 1`,
    userId,
    date,
  );
  return r ? { type: r.salary_type, amountPaise: r.amount_paise } : null;
}

const rupees = (paise: number) => formatRupees(Math.round(paise));

/**
 * Pay effect of one day in words and rupees (PRD 5.1 Day detail, S-11.2). Display only: the payslip
 * computes the month with exact fractions (WP-5); these lines round each amount once.
 */
export function dayPayLines(
  data: DayData,
  userId: string,
  day: DaySummary,
  c: Computed | null,
  salary: SalaryOn | null,
): DayPayLine[] {
  const lines: DayPayLine[] = [];
  const rules = data.rules;
  const owner = data.ownerName;
  if (day.lateMin > 0) {
    lines.push({
      code: 'late',
      label:
        day.lateBillableMin > 0
          ? `Late by ${day.lateMin} min. ${rules.graceMin} min grace, so ${day.lateBillableMin} min count.`
          : `Late by ${day.lateMin} min, within the ${rules.graceMin} min grace.`,
      formula: '',
      amountPaise: null,
    });
  }
  if (day.earlyMin > 0) {
    lines.push({
      code: 'early',
      label:
        day.earlyBillableMin > 0
          ? `Left ${day.earlyMin} min early.`
          : `Left ${day.earlyMin} min early, within the ${rules.earlyToleranceMin} min allowance.`,
      formula: '',
      amountPaise: null,
    });
  }
  const profile = data.people.get(userId);
  const monthly = salary?.type === 'monthly';
  let rDay: number | null = null;
  if (salary && profile) {
    if (monthly) {
      const month = day.workDate.slice(0, 7);
      const divisor = profile.divisor_override ?? data.settings.pay.divisor;
      const days =
        divisor === 'fixed30'
          ? 30
          : divisor === 'fixed26'
            ? 26
            : divisor === 'working'
              ? monthDates(month).filter((d) => scheduleFrom(data, userId, d)?.dayType === 'work')
                  .length
              : daysInMonth(month);
      rDay = days > 0 ? salary.amountPaise / days : null;
    } else {
      rDay = salary.amountPaise;
    }
  }
  const sDay = day.scheduledMin;
  const sStd = c?.schedule.stdMin ?? sDay;
  if (day.status === 'P' && day.undertimeMin > 0) {
    lines.push({
      code: 'undertime',
      label: `${day.undertimeMin} min short of the shift`,
      formula: rDay && sDay ? `${rupees(rDay)} x ${day.undertimeMin} / ${sDay} min` : '',
      amountPaise: rDay && sDay && monthly ? -Math.round((rDay * day.undertimeMin) / sDay) : null,
    });
  }
  if (monthly && rDay && (day.status === 'H' || day.status === 'A' || day.status === 'LOP')) {
    const share = day.status === 'H' ? 0.5 : 1;
    lines.push({
      code: day.status === 'H' ? 'half_day' : 'lop',
      label: day.status === 'H' ? 'Half day' : day.status === 'A' ? 'Absent' : 'Unpaid leave',
      formula: `${rupees(rDay)} x ${share} day`,
      amountPaise: -Math.round(rDay * share),
    });
  }
  if (day.otApprovedMin > 0) {
    const rate =
      json<OtRate | null>(profile?.ot_rate_override_json ?? null, null) ??
      data.settings.overtime.rate;
    let amount: number | null = null;
    let formula = '';
    if (rate.mode === 'multiplier' && rDay && sStd) {
      amount = Math.round((rDay * rate.multiplier * day.otApprovedMin) / sStd);
      formula = `${rupees(rDay)} x ${rate.multiplier} x ${day.otApprovedMin} / ${sStd} min`;
    } else if (rate.mode === 'flat') {
      amount = Math.round((rate.paisePerHour * day.otApprovedMin) / 60);
      formula = `${rupees(rate.paisePerHour)} an hour x ${day.otApprovedMin} min`;
    }
    lines.push({
      code: 'overtime',
      label:
        rate.mode === 'comp_off'
          ? `${day.otApprovedMin} min overtime, as comp-off`
          : rate.mode === 'unpaid'
            ? `${day.otApprovedMin} min overtime (not paid)`
            : `${day.otApprovedMin} min overtime approved`,
      formula,
      amountPaise: amount,
    });
  }
  if (day.otStatus === 'pending' && day.otCandidateMin > 0) {
    lines.push({
      code: 'info',
      label: `${day.otCandidateMin} min overtime waiting for ${owner}`,
      formula: '',
      amountPaise: null,
    });
  }
  if (day.offdayCredit > 0) {
    const holiday = day.dayType === 'HO';
    const comp = holiday
      ? (data.holidayByDate.get(day.workDate)?.workedComp ?? 'extra_pay')
      : data.settings.pay.weekOffWorked;
    if (comp === 'comp_off' || comp === 'both') {
      lines.push({
        code: 'comp_off',
        label: `Earned ${day.offdayCredit} comp-off day`,
        formula: '',
        amountPaise: null,
      });
    }
    if ((comp === 'extra_pay' || comp === 'both') && rDay) {
      const mult = data.settings.pay.offdayMultiplier;
      const extra = monthly ? rDay * (mult - 1) * day.offdayCredit : rDay * mult * day.offdayCredit;
      lines.push({
        code: 'offday_extra',
        label: holiday ? 'Worked on a holiday' : 'Worked on a week off',
        formula: `${rupees(rDay)} x ${monthly ? mult - 1 : mult} x ${day.offdayCredit}`,
        amountPaise: Math.round(extra),
      });
    }
  }
  return lines;
}
