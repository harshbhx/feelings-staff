/** Staff attendance endpoints: nonces, punches, Today, Month, Day, My data (PRD 4.3-4.5, 5.1, 9.4). */
import {
  addDays,
  DAY_MS,
  type DayDetail,
  istDate,
  type MonthView,
  type MyData,
  monthDates,
  type TodayView,
} from '@fs/contracts';
import type { Handlers } from '../../lib/api';
import { fail } from '../../lib/errors';
import { loadOrg } from '../../lib/settings';
import {
  computeFrom,
  dayAudit,
  dayPayLines,
  daySummary,
  loadDayData,
  monthTotals,
  salaryOn,
  scheduleView,
} from '../../services/day';
import { dutiesBetween, dutyViews, inWorkDateWindow } from '../../services/duty';
import { lockedMonths } from '../../services/leave';
import type { Ctx } from '../../services/ports';
import {
  createPunch,
  issueNonces,
  type PunchRow,
  proveWithDoorCode,
  punchViews,
  requestPunchApproval,
  sessionState,
} from '../../services/punch';
import { regularisationViews } from '../../services/regularisation';

function me(ctx: Ctx) {
  return ctx.user ?? fail('UNAUTHENTICATED');
}

/** The work date Today shows: the open session's, an active duty's, else today in IST. */
async function todayDate(ctx: Ctx, userId: string, now: number) {
  const last = await ctx.db.first<PunchRow>(
    `SELECT * FROM punches WHERE org_id = ?org AND user_id = ? AND status IN ('accepted', 'flagged', 'pending')
       AND effective_ts >= ? AND effective_ts <= ? ORDER BY effective_ts DESC, id DESC LIMIT 1`,
    userId,
    now - 20 * 3_600_000,
    now,
  );
  const state = sessionState(last);
  if (last && state !== 'out') return { date: last.work_date, state };
  const duties = await dutiesBetween(ctx, istDate(now - DAY_MS), istDate(now + DAY_MS), userId);
  const duty = duties.find((d) => inWorkDateWindow(d, now));
  return { date: duty?.work_date ?? istDate(now), state };
}

export const handlers: Handlers = {
  async punchNonce({ body }, ctx) {
    return issueNonces(ctx, body.purpose);
  },

  async punchCreate({ body, files }, ctx, c) {
    return createPunch(ctx, c, body, files);
  },

  async punchProof({ params, body }, ctx) {
    return proveWithDoorCode(ctx, params.id, body);
  },

  async punchRequestApproval({ params, body }, ctx) {
    return requestPunchApproval(ctx, params.id, body);
  },

  async meToday(_input, ctx): Promise<TodayView> {
    const user = me(ctx);
    const now = ctx.now();
    const { date, state } = await todayDate(ctx, user.id, now);
    const data = await loadDayData(ctx, [user.id], date, date);
    const c = computeFrom(data, user.id, date);
    if (!c) return fail('NOT_FOUND', 'Your staff profile is not set up yet.');
    const rows = (data.punches.get(`${user.id}|${date}`) ?? []).filter(
      (p) => p.status !== 'superseded',
    );
    const openIn =
      state === 'out'
        ? null
        : ([...rows].reverse().find((p) => p.kind === 'in' && p.status !== 'rejected') ?? null);
    const duties = await dutiesBetween(ctx, date, date, user.id);
    const [duty] = await dutyViews(ctx, duties.slice(0, 1));
    const schedule = scheduleView(data, c);
    const first = c.schedule.dayType === 'work' ? c.schedule.segments[0] : undefined;
    return {
      date,
      serverTime: now,
      schedule,
      state,
      inSinceTs: openIn?.effective_ts ?? null,
      punches: await punchViews(ctx, rows),
      day: daySummary(data, user.id, date),
      duty: duty ?? null,
      earliestCheckInTs: first
        ? first.startTs - data.settings.attendance.earliestCheckInMin * 60_000
        : null,
      pendingCount: rows.filter((p) => p.status === 'pending').length,
    };
  },

  async meDays({ query }, ctx): Promise<MonthView> {
    const user = me(ctx);
    const today = istDate(ctx.now());
    const dates = monthDates(query.month);
    const from = dates[0] as string;
    const to = dates[dates.length - 1] as string;
    const data = await loadDayData(ctx, [user.id], from, to);
    if (!data.people.has(user.id)) fail('NOT_FOUND', 'Your staff profile is not set up yet.');
    const days = dates
      .filter((d) => d <= today)
      .map((d) => daySummary(data, user.id, d))
      .filter((d): d is NonNullable<typeof d> => d !== null);
    const duties = await dutyViews(ctx, await dutiesBetween(ctx, from, to, user.id));
    return { month: query.month, days, totals: monthTotals(days), duties };
  },

  async meDay({ params }, ctx): Promise<DayDetail> {
    const user = me(ctx);
    const date = params.date;
    const now = ctx.now();
    const today = istDate(now);
    const month = monthDates(date.slice(0, 7));
    const data = await loadDayData(
      ctx,
      [user.id],
      month[0] as string,
      month[month.length - 1] as string,
    );
    const c = computeFrom(data, user.id, date);
    const day = daySummary(data, user.id, date);
    if (!c || !day) return fail('NOT_FOUND', 'Your staff profile is not set up yet.');
    const rows = (data.punches.get(`${user.id}|${date}`) ?? []).filter(
      (p) => p.status !== 'superseded',
    );
    const allIds = (data.punches.get(`${user.id}|${date}`) ?? []).map((p) => p.id);
    const [edits, salary, open, locked] = await Promise.all([
      dayAudit(ctx, user.id, date, allIds, true),
      salaryOn(ctx, user.id, date),
      regularisationViews(
        ctx,
        "r.user_id = ? AND r.work_date = ? AND r.status = 'pending'",
        user.id,
        date,
      ),
      lockedMonths(ctx, [date.slice(0, 7)]),
    ]);
    const window = data.settings.attendance.regularisationWindowDays;
    return {
      day,
      schedule: scheduleView(data, c),
      punches: await punchViews(ctx, rows),
      lines: dayPayLines(data, user.id, day, c, salary),
      edits,
      canRegularise:
        date <= today &&
        date >= addDays(today, -window) &&
        locked.length === 0 &&
        open.length === 0,
      openRegularisation: open[0] ?? null,
    };
  },

  async meData(_input, ctx): Promise<MyData> {
    const user = me(ctx);
    const now = ctx.now();
    const { org, settings } = await loadOrg(ctx);
    const locationDays = settings.privacy.locationRetentionDays;
    const selfieDays = settings.privacy.selfieRetentionDays;
    const rows = await ctx.db.all<PunchRow & { site_name: string | null }>(
      `SELECT p.*, s.name AS site_name FROM punches p LEFT JOIN sites s ON s.id = p.site_id
        WHERE p.org_id = ?org AND p.user_id = ? AND p.server_ts >= ? AND p.status <> 'superseded'
        ORDER BY p.effective_ts DESC LIMIT 500`,
      user.id,
      now - 366 * DAY_MS,
    );
    const consents = await ctx.db.all<{
      kind: MyData['consents'][number]['kind'];
      version: string;
      lang: string;
      accepted_at: number;
      withdrawn_at: number | null;
    }>(
      'SELECT kind, version, lang, accepted_at, withdrawn_at FROM consents WHERE org_id = ?org AND user_id = ? ORDER BY accepted_at DESC',
      user.id,
    );
    return {
      punches: rows.map((p) => ({
        id: p.id,
        kind: p.kind,
        effectiveTs: p.effective_ts,
        fenceResult: p.fence_result,
        distanceBucket: p.distance_bucket,
        placeName: p.place_name,
        siteName: p.site_name,
        locationKept: p.lat !== null,
        locationDeletesOn: p.lat !== null ? istDate(p.server_ts + locationDays * DAY_MS) : null,
      })),
      selfies: rows
        .filter((p) => p.selfie_key !== null && p.selfie_deleted_at === null)
        .map((p) => ({
          punchId: p.id,
          takenAt: p.server_ts,
          deletesOn: istDate(p.server_ts + selfieDays * DAY_MS),
          url: `/api/v1/me/punches/${p.id}/selfie`,
        })),
      consents: consents.map((x) => ({
        kind: x.kind,
        version: x.version,
        lang: x.lang,
        acceptedAt: x.accepted_at,
        withdrawnAt: x.withdrawn_at,
      })),
      retention: { locationDays, selfieDays, wageYears: 5 },
      grievance: {
        name: settings.privacy.grievanceName || org.owner_display_name,
        phone: settings.privacy.grievancePhone || org.phone_e164 || '',
      },
    };
  },
};
