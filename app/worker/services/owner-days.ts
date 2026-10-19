/**
 * Owner views of attendance (PRD 4.12, 5.2): the month register, the evidence for one person-day
 * and the owner's override of a day or its punches. Owner: WP-4.
 */
import {
  type DayOverride,
  type DayOverrideRequest,
  HOUR_MS,
  istDate,
  istStartOfDay,
  monthDates,
  type OwnerDayDetail,
  type RegisterView,
} from '@fs/contracts';
import { fail } from '../lib/errors';
import { ulid } from '../lib/ulid';
import {
  computeFrom,
  dayAudit,
  dayEntityId,
  dayPayLines,
  daySummary,
  loadDayData,
  monthTotals,
  personBrief,
  salaryOn,
  scheduleView,
} from './day';
import type { SiteRow } from './door';
import { dutiesBetween, dutyViews } from './duty';
import { lockedMonths, monthName } from './leave';
import type { Ctx } from './ports';
import {
  commitDayChange,
  insertPunchStmt,
  ownerPunchRow,
  ownerPunchViews,
  type PunchRow,
} from './punch';
import { siteView } from './site';

// ---- Register ----------------------------------------------------------------------------------------

export async function registerView(
  ctx: Ctx,
  month: string,
  userId: string | undefined,
): Promise<RegisterView> {
  const today = istDate(ctx.now());
  const dates = monthDates(month);
  const from = dates[0] as string;
  const to = dates[dates.length - 1] as string;
  const data = await loadDayData(ctx, userId ? [userId] : null, from, to);
  const people = [...data.people.values()]
    .filter((p) => p.join_date <= to && (p.exit_date === null || p.exit_date >= from))
    .sort((a, b) => a.name.localeCompare(b.name));
  const rows = people.map((p) => {
    const summaries = dates.map((d) => daySummary(data, p.user_id, d));
    const cells = dates.map((d, i) => {
      const s = summaries[i];
      return {
        status: s?.status ?? ('NE' as const),
        dayType: s?.dayType ?? ('NE' as const),
        tags: s?.tags ?? [],
        leaveCode: s?.leaveCode ?? null,
        lateMin: s?.lateMin ?? 0,
        inTs: s?.firstInTs ?? null,
        outTs: s?.lastOutTs ?? null,
        future: d > today,
      };
    });
    const past = summaries.filter(
      (s, i): s is NonNullable<typeof s> => s !== null && (dates[i] as string) <= today,
    );
    return { user: personBrief(p), cells, totals: monthTotals(past) };
  });
  const locked = (await lockedMonths(ctx, [month])).length > 0;
  return { month, dates, rows, locked };
}

// ---- Day detail --------------------------------------------------------------------------------------

export async function ownerDayDetail(
  ctx: Ctx,
  userId: string,
  date: string,
): Promise<OwnerDayDetail> {
  const data = await loadDayData(ctx, [userId], date, date);
  const profile = data.people.get(userId);
  if (!profile) return fail('NOT_FOUND', 'This person has no staff profile.');
  const c = computeFrom(data, userId, date);
  const day = daySummary(data, userId, date);
  if (!c || !day) return fail('NOT_FOUND', 'This person has no staff profile.');
  const all = data.punches.get(`${userId}|${date}`) ?? [];
  const rows = all.filter((p) => p.status !== 'superseded');
  const [punches, audit, salary, duties, siteRow] = await Promise.all([
    ownerPunchViews(ctx, rows),
    dayAudit(
      ctx,
      userId,
      date,
      all.map((p) => p.id),
    ),
    salaryOn(ctx, userId, date),
    dutiesBetween(ctx, date, date, userId),
    (async () => {
      const id = rows.find((p) => p.site_id)?.site_id ?? null;
      return id
        ? ctx.db.first<SiteRow>('SELECT * FROM sites WHERE org_id = ?org AND id = ?', id)
        : null;
    })(),
  ]);
  const [duty] = await dutyViews(ctx, duties.slice(0, 1));
  return {
    user: personBrief(profile),
    day,
    schedule: scheduleView(data, c),
    punches,
    site: siteRow ? siteView(siteRow) : null,
    duty: duty ?? null,
    lines: dayPayLines(data, userId, day, c, salary),
    enrolledPhotoUrl: profile.enrolled_photo_key ? `/api/v1/owner/staff/${userId}/photo` : null,
    audit,
    locked: day.locked,
  };
}

// ---- Override ----------------------------------------------------------------------------------------

/**
 * Owner override (PRD 4.12): set the day status and/or add, edit or delete punches, with a reason.
 * Edited and deleted punches are kept as `superseded`; the day shows "Edited by Urmi" with history.
 */
export async function overrideDay(
  ctx: Ctx,
  userId: string,
  date: string,
  body: DayOverrideRequest,
): Promise<OwnerDayDetail> {
  const locked = await lockedMonths(ctx, [date.slice(0, 7)]);
  if (locked.length > 0) fail('MONTH_LOCKED', `${monthName(date)} is closed.`);
  if (body.status === undefined && body.leaveCode === undefined && !body.punches?.length) {
    fail('VALIDATION', 'Change the status or a punch.', { field: 'status' });
  }
  if (body.status === 'L' && body.leaveCode === undefined) {
    fail('VALIDATION', 'Pick the leave type.', { field: 'leaveCode' });
  }
  const now = ctx.now();
  const data = await loadDayData(ctx, [userId], date, date);
  if (!data.people.has(userId)) fail('NOT_FOUND', 'This person has no staff profile.');
  const stored = data.punches.get(`${userId}|${date}`) ?? [];
  const before = daySummary(data, userId, date);

  const dayStart = istStartOfDay(date);
  const checkTs = (ts: number, field: string) => {
    if (ts > now) fail('VALIDATION', 'That time is in the future.', { field });
    if (ts < dayStart - 12 * HOUR_MS || ts > dayStart + 36 * HOUR_MS) {
      fail('VALIDATION', 'That time is not on this day.', { field });
    }
  };

  const changes: D1PreparedStatement[] = [];
  const superseded = new Set<string>();
  const added: PunchRow[] = [];
  const live = (id: string) => {
    const p = stored.find((x) => x.id === id);
    if (!p || p.status === 'superseded' || p.status === 'rejected') {
      return fail('NOT_FOUND', 'That punch is not on this day.');
    }
    return p;
  };

  for (const edit of body.punches ?? []) {
    if (edit.op === 'add') {
      checkTs(edit.ts, 'ts');
      const row = ownerPunchRow(ctx, {
        userId,
        kind: edit.kind,
        ts: edit.ts,
        workDate: date,
        key: `override:${ulid(now)}`,
        note: body.reason,
      });
      added.push(row);
      changes.push(
        insertPunchStmt(ctx, row),
        ctx.services.audit.stmt(ctx, {
          category: 'change',
          action: 'punch.create_owner',
          entity: 'punch',
          entityId: row.id,
          after: { kind: row.kind, effectiveTs: row.effective_ts, source: 'owner' },
          reason: body.reason,
        }),
      );
    } else if (edit.op === 'edit') {
      const target = live(edit.punchId);
      checkTs(edit.ts, 'ts');
      superseded.add(target.id);
      const row = ownerPunchRow(ctx, {
        userId,
        kind: target.kind,
        ts: edit.ts,
        workDate: date,
        key: `override:${ulid(now)}`,
        replaces: target,
        note: body.reason,
      });
      added.push(row);
      changes.push(
        ctx.db.update('punches', { status: 'superseded' }, 'id = ?', target.id),
        insertPunchStmt(ctx, row),
        ctx.services.audit.stmt(ctx, {
          category: 'change',
          action: 'punch.edit',
          entity: 'punch',
          entityId: target.id,
          before: { effectiveTs: target.effective_ts, status: target.status },
          after: { effectiveTs: edit.ts, replacementId: row.id },
          reason: body.reason,
        }),
      );
    } else {
      const target = live(edit.punchId);
      superseded.add(target.id);
      changes.push(
        ctx.db.update('punches', { status: 'superseded' }, 'id = ?', target.id),
        ctx.services.audit.stmt(ctx, {
          category: 'change',
          action: 'punch.delete',
          entity: 'punch',
          entityId: target.id,
          before: { effectiveTs: target.effective_ts, kind: target.kind, status: target.status },
          after: { status: 'superseded' },
          reason: body.reason,
        }),
      );
    }
  }

  let override: DayOverride | undefined;
  if (body.status !== undefined || body.leaveCode !== undefined) {
    override = {
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.leaveCode !== undefined ? { leaveCode: body.leaveCode } : {}),
      reason: body.reason,
      byUserId: ctx.user?.id ?? 'system',
      at: now,
    };
  }
  changes.push(
    ctx.services.audit.stmt(ctx, {
      category: 'change',
      action: 'day.override',
      entity: 'day',
      entityId: dayEntityId(userId, date),
      before: { status: before?.status ?? null, leaveCode: before?.leaveCode ?? null },
      after: {
        status: body.status ?? null,
        leaveCode: body.leaveCode ?? null,
        punchEdits: body.punches?.length ?? 0,
      },
      reason: body.reason,
    }),
  );

  await commitDayChange(
    ctx,
    userId,
    date,
    changes,
    (rows) => [
      ...rows.map((p) => (superseded.has(p.id) ? { ...p, status: 'superseded' as const } : p)),
      ...added,
    ],
    override,
  );
  return ownerDayDetail(ctx, userId, date);
}
