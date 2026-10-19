/**
 * Owner configuration that shapes attendance (PRD 4.6, 4.15.2, 5.2): shift templates, holidays,
 * no-leave days, the week roster, sites and calibration, off-site duties and door devices.
 * Every change writes its audit row in the same batch. Owner: WP-4.
 */
import {
  type DutyCreate,
  type DutyView,
  type HolidayView,
  hhmmToMin,
  isoWeekDates,
  isoWeekOf,
  istDate,
  type RosterChange,
  type RosterView,
  type ShiftTemplateView,
  type SiteView,
} from '@fs/contracts';
import { proposeCalibration } from '@fs/engine';
import { fail } from '../lib/errors';
import { ulid } from '../lib/ulid';
import { computeFrom, jsonList, loadDayData, personBrief, type TemplateRow } from './day';
import { type DoorDeviceRow, type SiteRow, salonSites } from './door';
import {
  createDutyStmts,
  DUTY_MARGIN_MS,
  type DutyInput,
  type DutyRow,
  dutyById,
  dutyStaffStmt,
  dutyViews,
  validateDuty,
} from './duty';
import { lockedMonths, monthName } from './leave';
import type { Ctx } from './ports';
import { safeEmit } from './punch';
import { siteView } from './site';

type Segment = ShiftTemplateView['segments'][number];

/** Recompute stored days for the dates up to today (future days are computed when read). */
async function recomputeUpToToday(ctx: Ctx, userIds: readonly string[], date: string) {
  if (date > istDate(ctx.now())) return;
  for (const id of new Set(userIds)) {
    try {
      await ctx.services.days.recompute(ctx, id, date);
    } catch (e) {
      console.error(JSON.stringify({ msg: 'owner_config.recompute_failed', error: String(e) }));
    }
  }
}

async function activeStaffIds(ctx: Ctx): Promise<string[]> {
  const rows = await ctx.db.all<{ user_id: string }>(
    `SELECT p.user_id FROM staff_profiles p JOIN users u ON u.id = p.user_id
      WHERE p.org_id = ?org AND u.status = 'active'`,
  );
  return rows.map((r) => r.user_id);
}

// ---- Shift templates ---------------------------------------------------------------------------

export function templateView(r: TemplateRow): ShiftTemplateView {
  const segments = JSON.parse(r.segments_json) as Segment[];
  const minutes = segments.reduce((sum, s) => {
    const span = hhmmToMin(s.end) - hhmmToMin(s.start);
    return sum + (span > 0 ? span : span + 1440);
  }, 0);
  return {
    id: r.id,
    name: r.name,
    segments,
    breakMin: r.break_min,
    scheduledMin: Math.max(0, minutes - r.break_min),
    active: r.active === 1,
    sort: r.sort,
  };
}

const TEMPLATE_COLS = 'id, name, segments_json, break_min, active, sort';

export async function listTemplates(ctx: Ctx): Promise<ShiftTemplateView[]> {
  const rows = await ctx.db.all<TemplateRow>(
    `SELECT ${TEMPLATE_COLS} FROM shift_templates WHERE org_id = ?org ORDER BY active DESC, sort, name`,
  );
  return rows.map(templateView);
}

async function templateRow(ctx: Ctx, id: string): Promise<TemplateRow> {
  const row = await ctx.db.first<TemplateRow>(
    `SELECT ${TEMPLATE_COLS} FROM shift_templates WHERE org_id = ?org AND id = ?`,
    id,
  );
  return row ?? fail('NOT_FOUND');
}

function checkSegments(segments: readonly Segment[]) {
  for (const s of segments) {
    if (hhmmToMin(s.start) === hhmmToMin(s.end)) {
      fail('VALIDATION', 'A shift must end after it starts.', { field: 'segments' });
    }
  }
}

export async function createTemplate(
  ctx: Ctx,
  body: { name: string; segments: Segment[]; breakMin: number },
): Promise<ShiftTemplateView> {
  checkSegments(body.segments);
  const dup = await ctx.db.first<{ id: string }>(
    'SELECT id FROM shift_templates WHERE org_id = ?org AND active = 1 AND lower(name) = lower(?)',
    body.name,
  );
  if (dup) fail('CONFLICT', 'There is already a shift with that name.', { field: 'name' });
  const now = ctx.now();
  const id = ulid(now);
  const max = await ctx.db.first<{ n: number | null }>(
    'SELECT MAX(sort) AS n FROM shift_templates WHERE org_id = ?org',
  );
  await ctx.db.batch([
    ctx.db.insert('shift_templates', {
      id,
      name: body.name,
      segments_json: JSON.stringify(body.segments),
      break_min: body.breakMin,
      active: 1,
      sort: (max?.n ?? 0) + 1,
      created_at: now,
      updated_at: now,
    }),
    ctx.services.audit.stmt(ctx, {
      category: 'change',
      action: 'shift_template.create',
      entity: 'shift_template',
      entityId: id,
      after: body,
    }),
  ]);
  return templateView(await templateRow(ctx, id));
}

export async function patchTemplate(
  ctx: Ctx,
  id: string,
  body: {
    name?: string | undefined;
    segments?: Segment[] | undefined;
    breakMin?: number | undefined;
    active?: boolean | undefined;
    sort?: number | undefined;
  },
): Promise<ShiftTemplateView> {
  const before = await templateRow(ctx, id);
  if (body.segments) checkSegments(body.segments);
  if (body.active === false) await assertTemplateUnused(ctx, id);
  const set = {
    name: body.name,
    segments_json: body.segments ? JSON.stringify(body.segments) : undefined,
    break_min: body.breakMin,
    active: body.active,
    sort: body.sort,
    updated_at: ctx.now(),
  };
  await ctx.db.batch([
    ctx.db.update('shift_templates', set, 'id = ?', id),
    ctx.services.audit.stmt(ctx, {
      category: 'change',
      action: 'shift_template.update',
      entity: 'shift_template',
      entityId: id,
      before: templateView(before),
      after: body,
    }),
  ]);
  return templateView(await templateRow(ctx, id));
}

async function assertTemplateUnused(ctx: Ctx, id: string): Promise<void> {
  const used = await ctx.db.first<{ n: number }>(
    `SELECT (SELECT COUNT(*) FROM staff_profiles p JOIN users u ON u.id = p.user_id
              WHERE p.org_id = ?org AND p.default_template_id = ? AND u.status <> 'exited')
          + (SELECT COUNT(*) FROM roster_overrides WHERE org_id = ?org AND template_id = ? AND work_date >= ?) AS n`,
    id,
    id,
    istDate(ctx.now()),
  );
  if ((used?.n ?? 0) > 0) {
    fail('CONFLICT', 'Some staff still use this shift. Move them to another shift first.');
  }
}

export async function deactivateTemplate(ctx: Ctx, id: string): Promise<void> {
  const before = await templateRow(ctx, id);
  await assertTemplateUnused(ctx, id);
  await ctx.db.batch([
    ctx.db.update('shift_templates', { active: false, updated_at: ctx.now() }, 'id = ?', id),
    ctx.services.audit.stmt(ctx, {
      category: 'change',
      action: 'shift_template.deactivate',
      entity: 'shift_template',
      entityId: id,
      before: templateView(before),
    }),
  ]);
}

// ---- Holidays and no-leave days --------------------------------------------------------------------

interface HolidayDb {
  id: string;
  date: string;
  name: string;
  paid: number;
  worked_comp: HolidayView['workedComp'];
}

const holidayView = (h: HolidayDb): HolidayView => ({
  id: h.id,
  date: h.date,
  name: h.name,
  paid: h.paid === 1,
  workedComp: h.worked_comp,
});

async function holidayRow(ctx: Ctx, id: string): Promise<HolidayDb> {
  const row = await ctx.db.first<HolidayDb>(
    'SELECT id, date, name, paid, worked_comp FROM holidays WHERE org_id = ?org AND id = ?',
    id,
  );
  return row ?? fail('NOT_FOUND');
}

export async function listHolidays(ctx: Ctx, year: number): Promise<HolidayView[]> {
  const rows = await ctx.db.all<HolidayDb>(
    `SELECT id, date, name, paid, worked_comp FROM holidays
      WHERE org_id = ?org AND date BETWEEN ? AND ? ORDER BY date`,
    `${year}-01-01`,
    `${year}-12-31`,
  );
  return rows.map(holidayView);
}

async function assertOpen(ctx: Ctx, date: string) {
  if ((await lockedMonths(ctx, [date.slice(0, 7)])).length > 0) {
    fail('MONTH_LOCKED', `${monthName(date)} is closed.`);
  }
}

export async function createHoliday(
  ctx: Ctx,
  body: { date: string; name: string; paid: boolean; workedComp: HolidayView['workedComp'] },
): Promise<HolidayView> {
  await assertOpen(ctx, body.date);
  const dup = await ctx.db.first<{ id: string }>(
    'SELECT id FROM holidays WHERE org_id = ?org AND date = ?',
    body.date,
  );
  if (dup) fail('CONFLICT', 'There is already a holiday on that date.', { field: 'date' });
  const now = ctx.now();
  const id = ulid(now);
  await ctx.db.batch([
    ctx.db.insert('holidays', {
      id,
      date: body.date,
      name: body.name,
      paid: body.paid,
      worked_comp: body.workedComp,
      created_at: now,
    }),
    ctx.services.audit.stmt(ctx, {
      category: 'change',
      action: 'holiday.create',
      entity: 'holiday',
      entityId: id,
      after: body,
    }),
  ]);
  await recomputeUpToToday(ctx, await activeStaffIds(ctx), body.date);
  ctx.waitUntil(
    safeEmit(ctx, {
      type: 'holiday_announced',
      orgId: ctx.orgId as string,
      at: now,
      date: body.date,
      name: body.name,
    }),
  );
  return holidayView(await holidayRow(ctx, id));
}

export async function patchHoliday(
  ctx: Ctx,
  id: string,
  body: {
    date?: string | undefined;
    name?: string | undefined;
    paid?: boolean | undefined;
    workedComp?: HolidayView['workedComp'] | undefined;
  },
): Promise<HolidayView> {
  const before = await holidayRow(ctx, id);
  await assertOpen(ctx, before.date);
  if (body.date && body.date !== before.date) {
    await assertOpen(ctx, body.date);
    const dup = await ctx.db.first<{ id: string }>(
      'SELECT id FROM holidays WHERE org_id = ?org AND date = ? AND id <> ?',
      body.date,
      id,
    );
    if (dup) fail('CONFLICT', 'There is already a holiday on that date.', { field: 'date' });
  }
  await ctx.db.batch([
    ctx.db.update(
      'holidays',
      {
        date: body.date,
        name: body.name,
        paid: body.paid,
        worked_comp: body.workedComp,
      },
      'id = ?',
      id,
    ),
    ctx.services.audit.stmt(ctx, {
      category: 'change',
      action: 'holiday.update',
      entity: 'holiday',
      entityId: id,
      before: holidayView(before),
      after: body,
    }),
  ]);
  const people = await activeStaffIds(ctx);
  await recomputeUpToToday(ctx, people, before.date);
  if (body.date) await recomputeUpToToday(ctx, people, body.date);
  return holidayView(await holidayRow(ctx, id));
}

export async function deleteHoliday(ctx: Ctx, id: string): Promise<void> {
  const before = await holidayRow(ctx, id);
  await assertOpen(ctx, before.date);
  await ctx.db.batch([
    ctx.db.stmt('DELETE FROM holidays WHERE org_id = ?org AND id = ?', id),
    ctx.services.audit.stmt(ctx, {
      category: 'change',
      action: 'holiday.delete',
      entity: 'holiday',
      entityId: id,
      before: holidayView(before),
    }),
  ]);
  await recomputeUpToToday(ctx, await activeStaffIds(ctx), before.date);
}

export async function listBlackout(ctx: Ctx, year: number) {
  return ctx.db.all<{ date: string; note: string | null }>(
    `SELECT date, note FROM blackout_days WHERE org_id = ?org AND date BETWEEN ? AND ? ORDER BY date`,
    `${year}-01-01`,
    `${year}-12-31`,
  );
}

export async function createBlackout(ctx: Ctx, body: BlackoutCreateBody) {
  const dup = await ctx.db.first<{ date: string }>(
    'SELECT date FROM blackout_days WHERE org_id = ?org AND date = ?',
    body.date,
  );
  if (dup) fail('CONFLICT', 'That day is already a no-leave day.', { field: 'date' });
  await ctx.db.batch([
    ctx.db.insert('blackout_days', { date: body.date, note: body.note ?? null }),
    ctx.services.audit.stmt(ctx, {
      category: 'change',
      action: 'blackout.create',
      entity: 'blackout_day',
      entityId: body.date,
      after: body,
    }),
  ]);
  return { date: body.date, note: body.note ?? null };
}

type BlackoutCreateBody = { date: string; note?: string | undefined };

export async function deleteBlackout(ctx: Ctx, date: string): Promise<void> {
  const row = await ctx.db.first<{ note: string | null }>(
    'SELECT note FROM blackout_days WHERE org_id = ?org AND date = ?',
    date,
  );
  if (!row) fail('NOT_FOUND');
  await ctx.db.batch([
    ctx.db.stmt('DELETE FROM blackout_days WHERE org_id = ?org AND date = ?', date),
    ctx.services.audit.stmt(ctx, {
      category: 'change',
      action: 'blackout.delete',
      entity: 'blackout_day',
      entityId: date,
      before: { date, note: row.note },
    }),
  ]);
}

// ---- Roster ----------------------------------------------------------------------------------------

export async function rosterView(ctx: Ctx, week: string): Promise<RosterView> {
  const dates = isoWeekDates(week);
  const from = dates[0] as string;
  const to = dates[6] as string;
  const data = await loadDayData(ctx, null, from, to);
  const overrides = await ctx.db.all<{ user_id: string; work_date: string }>(
    'SELECT user_id, work_date FROM roster_overrides WHERE org_id = ?org AND work_date BETWEEN ? AND ?',
    from,
    to,
  );
  const overridden = new Set(overrides.map((o) => `${o.user_id}|${o.work_date}`));
  const people = [...data.people.values()]
    .filter(
      (p) =>
        p.status === 'active' && p.join_date <= to && (p.exit_date === null || p.exit_date >= from),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  const limitMin = data.settings.overtime.weeklyHoursWarn * 60;
  const rows = people.map((p) => {
    let total = 0;
    const cells = dates.map((date) => {
      const c = computeFrom(data, p.user_id, date);
      const key = `${p.user_id}|${date}`;
      const duties = (data.duties.get(p.user_id) ?? [])
        .filter((d) => d.work_date === date)
        .map((d) => ({ id: d.id, placeName: d.place_name, startTs: d.start_ts, endTs: d.end_ts }));
      if (!c) {
        return emptyCell(date, overridden.has(key), duties);
      }
      const s = c.schedule;
      if (s.dayType === 'work') total += s.scheduledMin;
      const kind: RosterView['rows'][number]['cells'][number]['kind'] = c.leave
        ? 'L'
        : s.dayType === 'work'
          ? s.segments.length > 0
            ? 'template'
            : 'no_shift'
          : s.dayType;
      return {
        date,
        kind,
        templateId: s.templateId,
        templateName: s.templateName,
        segments: s.segments.map((x) => ({ start: hhmm(x.startTs), end: hhmm(x.endTs) })),
        override: overridden.has(key),
        leaveCode: c.leave?.code ?? null,
        duties,
      };
    });
    return { user: personBrief(p), cells, scheduledMin: total, over48: total > limitMin };
  });
  return {
    week,
    dates,
    rows,
    templates: (await listTemplates(ctx)).filter((t) => t.active),
  };
}

function hhmm(ts: number): string {
  const d = new Date(ts + 19_800_000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

function emptyCell(
  date: string,
  override: boolean,
  duties: RosterView['rows'][number]['cells'][number]['duties'],
): RosterView['rows'][number]['cells'][number] {
  return {
    date,
    kind: 'NE',
    templateId: null,
    templateName: null,
    segments: [],
    override,
    leaveCode: null,
    duties,
  };
}

/** Change days of the roster (a swap is two changes). Returns the week of the first change. */
export async function putRoster(ctx: Ctx, changes: RosterChange[]): Promise<RosterView> {
  const now = ctx.now();
  const today = istDate(now);
  const ids = [...new Set(changes.map((c) => c.userId))];
  const found = await ctx.db.all<{ id: string; name: string }>(
    `SELECT id, name FROM users WHERE org_id = ?org AND status = 'active'
        AND id IN (SELECT value FROM json_each(?))`,
    jsonList(ids),
  );
  if (found.length !== ids.length) fail('NOT_FOUND', 'Some staff were not found.');
  const months = changes.map((c) => c.date.slice(0, 7));
  const locked = await lockedMonths(ctx, months);
  if (locked.length > 0) fail('MONTH_LOCKED', `${monthName(locked[0] as string)} is closed.`);
  const templates = new Map((await listTemplates(ctx)).map((t) => [t.id, t]));
  const stmts: D1PreparedStatement[] = [];
  const summaries: { userId: string; date: string; summary: string }[] = [];
  for (const c of changes) {
    if (c.kind === 'template') {
      const t = c.templateId ? templates.get(c.templateId) : undefined;
      if (!t?.active) fail('VALIDATION', 'Pick a shift.', { field: 'templateId' });
    }
    if (c.kind === 'clear') {
      stmts.push(
        ctx.db.stmt(
          'DELETE FROM roster_overrides WHERE org_id = ?org AND user_id = ? AND work_date = ?',
          c.userId,
          c.date,
        ),
      );
    } else {
      stmts.push(
        ctx.db.stmt(
          `INSERT INTO roster_overrides (org_id, user_id, work_date, kind, template_id, note, created_by, created_at)
           VALUES (?org, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (user_id, work_date) DO UPDATE SET kind = excluded.kind,
             template_id = excluded.template_id, note = excluded.note,
             created_by = excluded.created_by, created_at = excluded.created_at
           WHERE roster_overrides.org_id = excluded.org_id`,
          c.userId,
          c.date,
          c.kind,
          c.kind === 'template' ? (c.templateId ?? null) : null,
          c.note ?? null,
          ctx.user?.id ?? 'system',
          now,
        ),
      );
    }
    stmts.push(
      ctx.services.audit.stmt(ctx, {
        category: 'change',
        action: 'roster.change',
        entity: 'roster',
        entityId: `${c.userId}|${c.date}`,
        after: { kind: c.kind, templateId: c.templateId ?? null },
        reason: c.note ?? null,
      }),
    );
    const label =
      c.kind === 'template'
        ? (templates.get(c.templateId ?? '')?.name ?? 'a new shift')
        : c.kind === 'week_off'
          ? 'a week off'
          : c.kind === 'no_shift'
            ? 'no shift'
            : 'the usual shift';
    summaries.push({ userId: c.userId, date: c.date, summary: `Your day is now ${label}.` });
  }
  await ctx.db.batch(stmts);
  for (const c of changes) await recomputeUpToToday(ctx, [c.userId], c.date);
  for (const s of summaries) {
    if (s.date >= today) {
      ctx.waitUntil(
        safeEmit(ctx, {
          type: 'schedule_changed',
          orgId: ctx.orgId as string,
          at: now,
          userId: s.userId,
          date: s.date,
          summary: s.summary,
        }),
      );
    }
  }
  return rosterView(ctx, isoWeekOf((changes[0] as RosterChange).date));
}

// ---- Sites and calibration ----------------------------------------------------------------------------

export async function listSites(ctx: Ctx): Promise<SiteView[]> {
  const rows = await ctx.db.all<SiteRow>(
    `SELECT * FROM sites WHERE org_id = ?org AND (kind = 'salon' OR (active = 1 AND (valid_to IS NULL OR valid_to >= ?)))
      ORDER BY kind, created_at`,
    ctx.now(),
  );
  return rows.map(siteView);
}

async function siteRow(ctx: Ctx, id: string): Promise<SiteRow> {
  const row = await ctx.db.first<SiteRow>('SELECT * FROM sites WHERE org_id = ?org AND id = ?', id);
  return row ?? fail('NOT_FOUND');
}

export async function patchSite(
  ctx: Ctx,
  id: string,
  body: {
    name?: string | undefined;
    lat?: number | undefined;
    lng?: number | undefined;
    radiusM?: number | undefined;
    maxAccuracyM?: number | undefined;
  },
): Promise<SiteView> {
  const before = await siteRow(ctx, id);
  await ctx.db.batch([
    ctx.db.update(
      'sites',
      {
        name: body.name,
        lat: body.lat,
        lng: body.lng,
        radius_m: body.radiusM,
        max_accuracy_m: body.maxAccuracyM,
        updated_at: ctx.now(),
      },
      'id = ?',
      id,
    ),
    ctx.services.audit.stmt(ctx, {
      category: 'change',
      action: 'site.update',
      entity: 'site',
      entityId: id,
      before: siteView(before),
      after: body,
    }),
  ]);
  return siteView(await siteRow(ctx, id));
}

export async function storeCalibration(
  ctx: Ctx,
  siteId: string,
  body: {
    sessionId: string;
    platform: string;
    samples: { lat: number; lng: number; accuracyM: number; takenAt: number }[];
  },
): Promise<{ stored: number; sessions: number }> {
  await siteRow(ctx, siteId);
  const stmts = body.samples.map((s) =>
    ctx.db.insert('calibration_samples', {
      id: ulid(ctx.now()),
      site_id: siteId,
      session_id: body.sessionId,
      lat: s.lat,
      lng: s.lng,
      accuracy_m: s.accuracyM,
      platform: body.platform,
      taken_at: s.takenAt,
    }),
  );
  stmts.push(
    ctx.services.audit.stmt(ctx, {
      category: 'change',
      action: 'site.calibration_samples',
      entity: 'site',
      entityId: siteId,
      after: { sessionId: body.sessionId, platform: body.platform, samples: body.samples.length },
    }),
  );
  await ctx.db.batch(stmts);
  const n = await ctx.db.first<{ n: number }>(
    'SELECT COUNT(DISTINCT session_id) AS n FROM calibration_samples WHERE org_id = ?org AND site_id = ?',
    siteId,
  );
  return { stored: body.samples.length, sessions: n?.n ?? 0 };
}

export async function proposeSite(ctx: Ctx, siteId: string) {
  const site = await siteRow(ctx, siteId);
  const rows = await ctx.db.all<{
    session_id: string;
    lat: number;
    lng: number;
    accuracy_m: number;
  }>(
    'SELECT session_id, lat, lng, accuracy_m FROM calibration_samples WHERE org_id = ?org AND site_id = ?',
    siteId,
  );
  const bySession = new Map<string, { lat: number; lng: number; accuracyM: number }[]>();
  for (const r of rows) {
    const list = bySession.get(r.session_id) ?? [];
    list.push({ lat: r.lat, lng: r.lng, accuracyM: r.accuracy_m });
    bySession.set(r.session_id, list);
  }
  const result = proposeCalibration([...bySession.values()]);
  if (!result) {
    return {
      centre: { lat: site.lat, lng: site.lng },
      radiusM: site.radius_m,
      stats: { sessions: 0, samples: 0, p95DistanceM: 0, medianAccuracyM: 0 },
      enoughData: false,
    };
  }
  return result;
}

// ---- Door devices --------------------------------------------------------------------------------------

export async function listDoorDevices(ctx: Ctx): Promise<DoorDeviceRow[]> {
  return ctx.db.all<DoorDeviceRow>(
    "SELECT * FROM door_devices WHERE org_id = ?org AND status <> 'revoked' ORDER BY created_at",
  );
}

// ---- Off-site duties -------------------------------------------------------------------------------------

export async function listDuties(ctx: Ctx, from: string, to: string): Promise<DutyView[]> {
  const rows = await ctx.db.all<DutyRow>(
    `SELECT d.*, st.lat AS site_lat, st.lng AS site_lng, st.radius_m AS site_radius_m,
            st.max_accuracy_m AS site_max_accuracy_m
       FROM offsite_duties d LEFT JOIN sites st ON st.id = d.site_id
      WHERE d.org_id = ?org AND d.cancelled_at IS NULL AND d.work_date BETWEEN ? AND ?
      ORDER BY d.start_ts`,
    from,
    to,
  );
  return dutyViews(ctx, rows);
}

export async function getDuty(ctx: Ctx, id: string): Promise<DutyView> {
  const row = await dutyById(ctx, id);
  if (!row) return fail('NOT_FOUND');
  const [view] = await dutyViews(ctx, [row]);
  return view ?? fail('NOT_FOUND');
}

function dutyEvent(
  ctx: Ctx,
  userIds: readonly string[],
  d: { id: string; workDate: string; startTs: number; endTs: number; placeName: string },
  change: 'created' | 'changed' | 'cancelled',
) {
  if (userIds.length === 0) return;
  ctx.waitUntil(
    safeEmit(ctx, {
      type: 'duty_assigned',
      orgId: ctx.orgId as string,
      at: ctx.now(),
      userIds: [...userIds],
      dutyId: d.id,
      workDate: d.workDate,
      startTs: d.startTs,
      endTs: d.endTs,
      placeName: d.placeName,
      change,
    }),
  );
}

export async function createDuty(ctx: Ctx, body: DutyCreate): Promise<DutyView> {
  await assertOpen(ctx, body.workDate);
  const made = await createDutyStmts(ctx, body, ctx.user?.id ?? 'system');
  await ctx.db.batch([
    ...made.stmts,
    ctx.services.audit.stmt(ctx, {
      category: 'change',
      action: 'duty.create',
      entity: 'duty',
      entityId: made.dutyId,
      after: {
        workDate: body.workDate,
        startTs: body.startTs,
        endTs: body.endTs,
        placeName: body.placeName,
        mode: body.mode,
        userIds: body.userIds,
      },
    }),
  ]);
  await recomputeDutyDays(ctx, body.userIds, body.workDate);
  dutyEvent(ctx, [...new Set(body.userIds)], { id: made.dutyId, ...body }, 'created');
  return getDuty(ctx, made.dutyId);
}

async function recomputeDutyDays(ctx: Ctx, userIds: readonly string[], date: string) {
  await recomputeUpToToday(ctx, userIds, date);
}

async function dutyStaffIds(ctx: Ctx, dutyId: string): Promise<string[]> {
  const rows = await ctx.db.all<{ user_id: string }>(
    `SELECT s.user_id FROM offsite_duty_staff s JOIN users u ON u.id = s.user_id
      WHERE u.org_id = ?org AND s.duty_id = ?`,
    dutyId,
  );
  return rows.map((r) => r.user_id);
}

export async function patchDuty(
  ctx: Ctx,
  id: string,
  body: Partial<DutyCreate>,
): Promise<DutyView> {
  const row = await dutyById(ctx, id);
  if (!row || row.cancelled_at !== null) return fail('NOT_FOUND');
  const staff = await dutyStaffIds(ctx, id);
  const input: DutyInput = {
    userIds: body.userIds ?? staff,
    workDate: body.workDate ?? row.work_date,
    startTs: body.startTs ?? row.start_ts,
    endTs: body.endTs ?? row.end_ts,
    placeName: body.placeName ?? row.place_name,
    location:
      body.location !== undefined
        ? body.location
        : row.site_lat !== null && row.site_lng !== null
          ? { lat: row.site_lat, lng: row.site_lng }
          : null,
    radiusM: body.radiusM ?? row.site_radius_m ?? 200,
    mode: body.mode ?? row.mode,
    otPreapproved: body.otPreapproved ?? row.ot_preapproved === 1,
    note: body.note !== undefined ? body.note : row.note,
  };
  await assertOpen(ctx, input.workDate);
  await validateDuty(ctx, input);
  const now = ctx.now();
  const stmts: D1PreparedStatement[] = [];
  let siteId = row.site_id;
  if (input.mode === 'anywhere') {
    siteId = null;
  } else if (input.location) {
    if (siteId) {
      stmts.push(
        ctx.db.update(
          'sites',
          {
            name: input.placeName,
            lat: input.location.lat,
            lng: input.location.lng,
            radius_m: input.radiusM,
            valid_from: input.startTs - DUTY_MARGIN_MS,
            valid_to: input.endTs + DUTY_MARGIN_MS,
            updated_at: now,
          },
          'id = ?',
          siteId,
        ),
      );
    } else {
      siteId = ulid(now);
      const salon = (await salonSites(ctx))[0];
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
          created_by: ctx.user?.id ?? 'system',
          created_at: now,
          updated_at: now,
        }),
      );
    }
  }
  stmts.push(
    ctx.db.update(
      'offsite_duties',
      {
        site_id: siteId,
        work_date: input.workDate,
        start_ts: input.startTs,
        end_ts: input.endTs,
        mode: input.mode,
        ot_preapproved: input.otPreapproved,
        place_name: input.placeName,
        note: input.note ?? null,
      },
      'id = ?',
      id,
    ),
  );
  const wanted = new Set(input.userIds);
  for (const uid of staff) {
    if (!wanted.has(uid)) {
      stmts.push(
        ctx.db.stmt(
          'DELETE FROM offsite_duty_staff WHERE duty_id = ? AND user_id = ? AND duty_id IN (SELECT id FROM offsite_duties WHERE org_id = ?org)',
          id,
          uid,
        ),
      );
    }
  }
  for (const uid of wanted) if (!staff.includes(uid)) stmts.push(dutyStaffStmt(ctx, id, uid));
  stmts.push(
    ctx.services.audit.stmt(ctx, {
      category: 'change',
      action: 'duty.update',
      entity: 'duty',
      entityId: id,
      before: {
        workDate: row.work_date,
        startTs: row.start_ts,
        endTs: row.end_ts,
        placeName: row.place_name,
        mode: row.mode,
        userIds: staff,
      },
      after: { ...body },
    }),
  );
  await ctx.db.batch(stmts);
  const everyone = [...new Set([...staff, ...input.userIds])];
  await recomputeDutyDays(ctx, everyone, row.work_date);
  if (input.workDate !== row.work_date) await recomputeDutyDays(ctx, everyone, input.workDate);
  dutyEvent(
    ctx,
    everyone,
    {
      id,
      workDate: input.workDate,
      startTs: input.startTs,
      endTs: input.endTs,
      placeName: input.placeName,
    },
    'changed',
  );
  return getDuty(ctx, id);
}

export async function cancelDuty(ctx: Ctx, id: string): Promise<void> {
  const row = await dutyById(ctx, id);
  if (!row || row.cancelled_at !== null) return fail('NOT_FOUND');
  await assertOpen(ctx, row.work_date);
  const staff = await dutyStaffIds(ctx, id);
  const stmts = [
    ctx.db.update('offsite_duties', { cancelled_at: ctx.now() }, 'id = ?', id),
    ...(row.site_id
      ? [ctx.db.update('sites', { active: false }, "id = ? AND kind = 'venue'", row.site_id)]
      : []),
    ctx.services.audit.stmt(ctx, {
      category: 'change',
      action: 'duty.cancel',
      entity: 'duty',
      entityId: id,
      before: { workDate: row.work_date, placeName: row.place_name, userIds: staff },
    }),
  ];
  await ctx.db.batch(stmts);
  await recomputeDutyDays(ctx, staff, row.work_date);
  dutyEvent(
    ctx,
    staff,
    {
      id,
      workDate: row.work_date,
      startTs: row.start_ts,
      endTs: row.end_ts,
      placeName: row.place_name,
    },
    'cancelled',
  );
}
