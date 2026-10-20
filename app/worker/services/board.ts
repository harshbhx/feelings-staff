/**
 * The owner's live Today board (PRD 5.2 "Today"): who is in, who has not come yet, who is away and
 * who has left, computed from the same day engine as everything else. Owner: WP-4.
 */
import {
  type BoardInRow,
  type BoardNotInRow,
  istDate,
  istTime,
  type TodayBoard,
} from '@fs/contracts';
import { computeFrom, loadDayData, personBrief } from './day';
import { actionsCount } from './owner-actions';
import type { Ctx } from './ports';
import type { PunchRow } from './punch';
import { todayRollCall } from './rollcall';

type PlaceBadge = BoardInRow['place'];
type BoardAwayRow = TodayBoard['away'][number];

function placeOf(p: PunchRow): PlaceBadge {
  if (p.source === 'owner') return 'owner';
  if (p.source === 'offline') return 'offline';
  if (p.offsite_duty_id !== null || p.place_name !== null) return 'venue';
  if (p.fence_result === 'uncertain') return 'edge';
  return 'inside';
}

export async function todayBoard(ctx: Ctx): Promise<TodayBoard> {
  const now = ctx.now();
  const date = istDate(now);
  const data = await loadDayData(ctx, null, date, date);
  const holiday = data.holidayByDate.get(date) ?? null;

  const siteIds = new Set<string>();
  for (const rows of data.punches.values()) {
    for (const p of rows) if (p.site_id) siteIds.add(p.site_id);
  }
  const siteName = new Map<string, string>();
  if (siteIds.size > 0) {
    const rows = await ctx.db.all<{ id: string; name: string }>(
      'SELECT id, name FROM sites WHERE org_id = ?org AND id IN (SELECT value FROM json_each(?))',
      JSON.stringify([...siteIds]),
    );
    for (const r of rows) siteName.set(r.id, r.name);
  }

  const inRows: BoardInRow[] = [];
  const outRows: BoardInRow[] = [];
  const notIn: BoardNotInRow[] = [];
  const away: BoardAwayRow[] = [];
  let firstShift: string | null = null;
  let late = 0;
  let atVenue = 0;

  const people = [...data.people.values()]
    .filter(
      (p) =>
        p.status === 'active' &&
        p.join_date <= date &&
        (p.exit_date === null || p.exit_date >= date),
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const person of people) {
    const c = computeFrom(data, person.user_id, date);
    if (!c) continue;
    const brief = personBrief(person);
    const rows = (data.punches.get(`${person.user_id}|${date}`) ?? []).filter(
      (p) => p.status !== 'superseded' && p.status !== 'rejected',
    );
    const counted = rows.filter((p) => p.status === 'accepted' || p.status === 'flagged');
    const firstIn = counted.find((p) => p.kind === 'in') ?? null;
    const pendingIn = rows.find((p) => p.status === 'pending' && p.kind === 'in') ?? null;
    const shiftStartTs = c.schedule.segments[0]?.startTs ?? null;
    const shiftStart = shiftStartTs === null ? null : istTime(shiftStartTs);
    if (shiftStart && (firstShift === null || shiftStart < firstShift)) firstShift = shiftStart;

    const present = firstIn ?? pendingIn;
    if (present) {
      const open = firstIn !== null && c.result.open;
      const estimate = Math.max(0, Math.floor((now - present.effective_ts) / 60_000));
      const row: BoardInRow = {
        user: brief,
        inTs: present.effective_ts,
        outTs: open || firstIn === null ? null : c.result.lastOutTs,
        lateMin: c.result.lateMin,
        place: placeOf(present),
        placeName: present.site_id
          ? (siteName.get(present.site_id) ?? present.place_name)
          : present.place_name,
        workedMin: open
          ? Math.max(c.result.workedMin, estimate - c.result.breakMin)
          : c.result.workedMin,
        flagged: rows.some((p) => p.status === 'flagged'),
        pending: firstIn === null,
      };
      if (row.lateMin > 0) late += 1;
      if (row.place === 'venue') atVenue += 1;
      (row.outTs === null ? inRows : outRows).push(row);
      continue;
    }

    if (c.leave) {
      away.push({ user: brief, reason: 'leave', leaveCode: c.leave.code });
    } else if (c.schedule.dayType === 'WO') {
      away.push({ user: brief, reason: 'week_off', leaveCode: null });
    } else if (c.schedule.dayType === 'HO') {
      away.push({ user: brief, reason: 'holiday', leaveCode: null });
    } else if (c.schedule.dayType === 'work' && shiftStartTs !== null) {
      notIn.push({
        user: brief,
        shiftStart,
        state: now >= shiftStartTs ? 'not_in_yet' : 'due_later',
        minutesLate: Math.max(0, Math.floor((now - shiftStartTs) / 60_000)),
      });
    }
  }

  inRows.sort((a, b) => b.inTs - a.inTs);
  outRows.sort((a, b) => b.inTs - a.inTs);
  notIn.sort((a, b) => (a.shiftStart ?? '').localeCompare(b.shiftStart ?? ''));

  return {
    date,
    updatedAt: now,
    closed: holiday ? { holidayName: holiday.name } : null,
    firstShiftStart: firstShift,
    counters: {
      present: inRows.length + outRows.length,
      late,
      notInYet: notIn.length,
      onLeave: away.filter((a) => a.reason === 'leave').length,
      weekOff: away.filter((a) => a.reason === 'week_off').length,
      atVenue,
      checkedOut: outRows.length,
    },
    in: inRows,
    notIn,
    out: outRows,
    away,
    rollCall: await todayRollCall(ctx, date),
    actionsCount: await actionsCount(ctx),
  };
}
