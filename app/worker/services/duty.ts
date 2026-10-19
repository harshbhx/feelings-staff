/**
 * Off-site duties (PRD 4.6 A, 7.2, 7.11): rows, views, the windows the punch pipeline checks, and
 * duty creation with its venue site. Owner: WP-4.
 */
import {
  type DutyCreate,
  type DutyView,
  HOUR_MS,
  hhmmToMin,
  istDate,
  istTime,
  istToEpoch,
  type OffsiteMode,
} from '@fs/contracts';
import { fail } from '../lib/errors';
import { ulid } from '../lib/ulid';
import { jsonList, personBrief } from './day';
import type { Ctx } from './ports';

export interface DutyRow {
  id: string;
  org_id: string;
  site_id: string | null;
  work_date: string;
  start_ts: number;
  end_ts: number;
  mode: OffsiteMode;
  ot_preapproved: number;
  place_name: string;
  note: string | null;
  created_by: string;
  created_at: number;
  cancelled_at: number | null;
  site_lat: number | null;
  site_lng: number | null;
  site_radius_m: number | null;
  site_max_accuracy_m: number | null;
}

/** A duty counts for punches from 2 h before its start to 2 h after its end (PRD 4.4.1). */
export const DUTY_MARGIN_MS = 2 * HOUR_MS;
export const DUTY_MAX_MS = 24 * HOUR_MS;
export const VENUE_RADIUS_DEFAULT_M = 200;

export const DUTY_SELECT = `SELECT d.*, st.lat AS site_lat, st.lng AS site_lng, st.radius_m AS site_radius_m,
       st.max_accuracy_m AS site_max_accuracy_m
  FROM offsite_duties d LEFT JOIN sites st ON st.id = d.site_id`;

/** Night hours: starts before 06:00 or ends after 21:00 IST (PRD 7.11). */
export function isNightWindow(startTs: number, endTs: number): boolean {
  return hhmmToMin(istTime(startTs)) < 6 * 60 || endTs > istToEpoch(istDate(startTs), '21:00');
}

/** Is `ts` inside the punch window of the duty (start - 2 h to end + 2 h)? */
export const inPunchWindow = (d: Pick<DutyRow, 'start_ts' | 'end_ts'>, ts: number) =>
  ts >= d.start_ts - DUTY_MARGIN_MS && ts <= d.end_ts + DUTY_MARGIN_MS;

/** Work-date window of an `in` punch: start - 2 h to end (PRD 7.2). */
export const inWorkDateWindow = (d: Pick<DutyRow, 'start_ts' | 'end_ts'>, ts: number) =>
  ts >= d.start_ts - DUTY_MARGIN_MS && ts <= d.end_ts;

/** Active (not cancelled) duties of a person whose punch window contains `ts`. */
export async function activeDutiesFor(ctx: Ctx, userId: string, ts: number): Promise<DutyRow[]> {
  return ctx.db.all<DutyRow>(
    `${DUTY_SELECT}
      WHERE d.org_id = ?org AND d.cancelled_at IS NULL
        AND d.id IN (SELECT duty_id FROM offsite_duty_staff WHERE user_id = ?)
        AND d.start_ts - ? <= ? AND d.end_ts + ? >= ?
      ORDER BY d.start_ts`,
    userId,
    DUTY_MARGIN_MS,
    ts,
    DUTY_MARGIN_MS,
    ts,
  );
}

export async function dutyById(ctx: Ctx, id: string): Promise<DutyRow | null> {
  return ctx.db.first<DutyRow>(`${DUTY_SELECT} WHERE d.org_id = ?org AND d.id = ?`, id);
}

/** Views with their staff lists. */
export async function dutyViews(ctx: Ctx, rows: readonly DutyRow[]): Promise<DutyView[]> {
  if (rows.length === 0) return [];
  const staff = await ctx.db.all<{
    duty_id: string;
    id: string;
    name: string;
    phone_e164: string | null;
    designation: string | null;
  }>(
    `SELECT s.duty_id, u.id, u.name, u.phone_e164, p.designation
       FROM offsite_duty_staff s
       JOIN offsite_duties d ON d.id = s.duty_id
       JOIN users u ON u.id = s.user_id
       LEFT JOIN staff_profiles p ON p.user_id = u.id
      WHERE d.org_id = ?org AND s.duty_id IN (SELECT value FROM json_each(?))
      ORDER BY u.name`,
    jsonList(rows.map((r) => r.id)),
  );
  return rows.map((d) => ({
    id: d.id,
    workDate: d.work_date,
    startTs: d.start_ts,
    endTs: d.end_ts,
    mode: d.mode,
    otPreapproved: d.ot_preapproved === 1,
    placeName: d.place_name,
    note: d.note,
    site:
      d.site_id !== null && d.site_lat !== null && d.site_lng !== null
        ? { id: d.site_id, lat: d.site_lat, lng: d.site_lng, radiusM: d.site_radius_m ?? 200 }
        : null,
    staff: staff.filter((s) => s.duty_id === d.id).map((s) => personBrief(s)),
    nightHours: isNightWindow(d.start_ts, d.end_ts),
    cancelledAt: d.cancelled_at,
    createdAt: d.created_at,
  }));
}

/** Duties (not cancelled) with a work date in [from, to], optionally for one person. */
export async function dutiesBetween(
  ctx: Ctx,
  from: string,
  to: string,
  userId?: string,
  includeCancelled = false,
): Promise<DutyRow[]> {
  return ctx.db.all<DutyRow>(
    `${DUTY_SELECT}
      WHERE d.org_id = ?org AND d.work_date BETWEEN ? AND ?
        ${includeCancelled ? '' : 'AND d.cancelled_at IS NULL'}
        ${userId ? 'AND d.id IN (SELECT duty_id FROM offsite_duty_staff WHERE user_id = ?)' : ''}
      ORDER BY d.start_ts`,
    from,
    to,
    ...(userId ? [userId] : []),
  );
}

export interface DutyInput {
  userIds: readonly string[];
  workDate: string;
  startTs: number;
  endTs: number;
  placeName: string;
  location: { lat: number; lng: number } | null;
  radiusM: number;
  mode: OffsiteMode;
  otPreapproved: boolean;
  note?: string | null | undefined;
}

/** Rules shared by create and patch (PRD 4.6 A). */
export async function validateDuty(ctx: Ctx, input: DutyInput): Promise<void> {
  if (input.endTs <= input.startTs) {
    fail('VALIDATION', 'The duty must end after it starts.', { field: 'endTs' });
  }
  if (input.endTs - input.startTs > DUTY_MAX_MS) {
    fail('VALIDATION', 'A duty can be at most 24 hours long.', { field: 'endTs' });
  }
  if (istDate(input.startTs) !== input.workDate) {
    fail('VALIDATION', 'The duty belongs to the date it starts on.', { field: 'workDate' });
  }
  if (input.mode !== 'anywhere' && input.location === null) {
    fail('VALIDATION', 'Pick the venue location, or choose "Anywhere".', { field: 'location' });
  }
  const found = await ctx.db.first<{ n: number }>(
    `SELECT COUNT(*) AS n FROM users
      WHERE org_id = ?org AND id IN (SELECT value FROM json_each(?)) AND status <> 'exited'`,
    jsonList(input.userIds),
  );
  if ((found?.n ?? 0) !== new Set(input.userIds).size)
    fail('NOT_FOUND', 'Some staff were not found.');
}

/**
 * Statements that create a duty, its venue site (unless mode is "anywhere") and its staff rows.
 * The caller adds the audit row and commits them in one batch.
 */
export async function createDutyStmts(
  ctx: Ctx,
  input: DutyInput | DutyCreate,
  createdBy: string,
): Promise<{ dutyId: string; siteId: string | null; stmts: D1PreparedStatement[] }> {
  await validateDuty(ctx, input);
  const now = ctx.now();
  const dutyId = ulid(now);
  const stmts: D1PreparedStatement[] = [];
  let siteId: string | null = null;
  if (input.mode !== 'anywhere' && input.location) {
    siteId = ulid(now);
    const salon = await ctx.db.first<{ max_accuracy_m: number }>(
      "SELECT max_accuracy_m FROM sites WHERE org_id = ?org AND kind = 'salon' AND active = 1 ORDER BY created_at LIMIT 1",
    );
    stmts.push(
      ctx.db.insert('sites', {
        id: siteId,
        kind: 'venue',
        name: input.placeName,
        lat: input.location.lat,
        lng: input.location.lng,
        radius_m: input.radiusM,
        max_accuracy_m: salon?.max_accuracy_m ?? 50,
        active: 1,
        valid_from: input.startTs - DUTY_MARGIN_MS,
        valid_to: input.endTs + DUTY_MARGIN_MS,
        created_by: createdBy,
        created_at: now,
        updated_at: now,
      }),
    );
  }
  stmts.push(
    ctx.db.insert('offsite_duties', {
      id: dutyId,
      site_id: siteId,
      work_date: input.workDate,
      start_ts: input.startTs,
      end_ts: input.endTs,
      mode: input.mode,
      ot_preapproved: input.otPreapproved,
      place_name: input.placeName,
      note: input.note ?? null,
      created_by: createdBy,
      created_at: now,
    }),
  );
  for (const userId of new Set(input.userIds)) stmts.push(dutyStaffStmt(ctx, dutyId, userId));
  return { dutyId, siteId, stmts };
}

/** offsite_duty_staff has no org_id: the insert only succeeds for a user of this org. */
export function dutyStaffStmt(ctx: Ctx, dutyId: string, userId: string): D1PreparedStatement {
  return ctx.db.stmt(
    'INSERT OR IGNORE INTO offsite_duty_staff (duty_id, user_id) SELECT ?, id FROM users WHERE org_id = ?org AND id = ?',
    dutyId,
    userId,
  );
}
