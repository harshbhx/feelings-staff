/**
 * The owner's Needs-action queue and the decisions behind it (PRD 4.12, 9.4). Owner: WP-4.
 *
 * `listActions` builds every item type (flagged and pending punches, new devices, leave, fixes,
 * overtime, off-site requests, auto-closed days, advance requests). The decision functions write
 * the change, the day recompute and the audit row in one batch, then tell the staff member.
 * Leave, fix and device decisions reuse the services that own them.
 */
import {
  type ActionItem,
  type ActionsView,
  ActionType,
  addDays,
  DAY_MS,
  type Endpoints,
  istDate,
  istStartOfDay,
  istTime,
  type OutputOf,
  type PersonBrief,
  type PunchResult,
} from '@fs/contracts';
import { fail, isApiException } from '../lib/errors';
import { ulid } from '../lib/ulid';
import {
  computeFrom,
  dayEntityId,
  loadDayData,
  type OtDecisionRow,
  personBrief,
  planDay,
  scheduleFrom,
} from './day';
import { type DeviceRow, deviceView } from './device';
import { type SiteRow, salonSites } from './door';
import { createDutyStmts, DUTY_MAX_MS } from './duty';
import { decideLeave, leaveBalances, leaveRequestViews, lockedMonths, monthName } from './leave';
import type { Ctx } from './ports';
import type { AwayRow } from './presence-rows';
import {
  commitDayChange,
  insertPunchStmt,
  outcomeOf,
  ownerPunchRow,
  ownerPunchViews,
  type PunchRow,
  punchById,
  punchResult,
  safeEmit,
} from './punch';
import { decideRegularisation, regularisationViews } from './regularisation';
import { siteView } from './site';

const LOOKBACK_DAYS = 60;

// ---- Lists ----------------------------------------------------------------------------------------

async function briefs(ctx: Ctx, ids: readonly string[]): Promise<Map<string, PersonBrief>> {
  const list = [...new Set(ids)];
  if (list.length === 0) return new Map();
  const rows = await ctx.db.all<{
    id: string;
    name: string;
    designation: string | null;
    phone_e164: string | null;
  }>(
    `SELECT u.id, u.name, p.designation, u.phone_e164 FROM users u
       LEFT JOIN staff_profiles p ON p.user_id = u.id
      WHERE u.org_id = ?org AND u.id IN (SELECT value FROM json_each(?))`,
    JSON.stringify(list),
  );
  return new Map(rows.map((r) => [r.id, personBrief(r)]));
}

const unknownPerson = (id: string): PersonBrief => ({
  id,
  name: 'Someone',
  designation: null,
  phone: null,
});

function mapEvidence(row: PunchRow, sites: Map<string, SiteRow>, salon: SiteRow | null) {
  const site = (row.site_id ? sites.get(row.site_id) : undefined) ?? salon;
  return {
    lat: row.lat,
    lng: row.lng,
    accuracyM: row.accuracy_m,
    distanceM: row.distance_m,
    site: site ? siteView(site) : null,
  };
}

/** Every waiting item, grouped by type in the order of `ActionType`, newest first inside a type. */
export async function listActions(ctx: Ctx, only?: ActionType): Promise<ActionsView> {
  const now = ctx.now();
  const today = istDate(now);
  const since = addDays(today, -LOOKBACK_DAYS);
  const wants = (t: ActionType) => only === undefined || only === t;

  const [punches, devices, leave, regs, otDays, autoOuts, advances] = await Promise.all([
    ctx.db.all<PunchRow>(
      `SELECT * FROM punches WHERE org_id = ?org AND work_date >= ?
          AND ((status = 'flagged' AND source <> 'auto' AND reviewed_at IS NULL) OR status = 'pending')
        ORDER BY created_at DESC LIMIT 300`,
      since,
    ),
    ctx.db.all<DeviceRow>(
      "SELECT * FROM devices WHERE org_id = ?org AND status = 'pending' ORDER BY requested_at DESC",
    ),
    leaveRequestViews(ctx, "r.status = 'pending'"),
    regularisationViews(ctx, "r.status = 'pending'"),
    ctx.db.all<{
      user_id: string;
      work_date: string;
      ot_candidate_min: number;
      ot_preapproved_min: number;
      computed_at: number;
    }>(
      `SELECT user_id, work_date, ot_candidate_min, ot_preapproved_min, computed_at FROM attendance_days
        WHERE org_id = ?org AND ot_status = 'pending' AND ot_candidate_min > 0 AND locked = 0
          AND work_date >= ? ORDER BY work_date DESC`,
      since,
    ),
    ctx.db.all<PunchRow>(
      `SELECT * FROM punches WHERE org_id = ?org AND source = 'auto' AND kind = 'out'
          AND status IN ('flagged', 'accepted') AND reviewed_at IS NULL AND work_date >= ?
        ORDER BY created_at DESC`,
      since,
    ),
    ctx.db.all<{
      id: string;
      user_id: string;
      amount_paise: number;
      reason: string | null;
      plan: 'full' | 'instalments';
      instalments_n: number | null;
      first_month: string;
      created_at: number;
    }>(
      "SELECT * FROM advances WHERE org_id = ?org AND status = 'requested' ORDER BY created_at DESC",
    ),
  ]);

  const flagged = punches.filter((p) => p.status === 'flagged');
  const pending = punches.filter((p) => p.status === 'pending' && outcomeOf(p, now) === 'pending');
  const offsite = pending.filter((p) => p.pending_reason === 'offsite_unplanned');
  const plain = pending.filter((p) => p.pending_reason !== 'offsite_unplanned');

  const pendingAway = wants('away')
    ? await ctx.db.all<AwayRow>(
        `SELECT * FROM away_intervals WHERE org_id = ?org AND state = 'pending' AND end_ts IS NOT NULL
          ORDER BY end_ts DESC LIMIT 200`,
      )
    : [];
  const people = await briefs(ctx, [
    ...pendingAway.map((a) => a.user_id),
    ...punches.map((p) => p.user_id),
    ...autoOuts.map((p) => p.user_id),
    ...devices.map((d) => d.user_id),
    ...otDays.map((d) => d.user_id),
    ...advances.map((a) => a.user_id),
  ]);
  const who = (id: string) => people.get(id) ?? unknownPerson(id);

  const siteIds = punches.map((p) => p.site_id).filter((x): x is string => x !== null);
  const siteRows = siteIds.length
    ? await ctx.db.all<SiteRow>(
        'SELECT * FROM sites WHERE org_id = ?org AND id IN (SELECT value FROM json_each(?))',
        JSON.stringify([...new Set(siteIds)]),
      )
    : [];
  const sites = new Map(siteRows.map((s) => [s.id, s]));
  const salon = (await salonSites(ctx))[0] ?? null;

  const items: ActionItem[] = [];

  const punchItems = async (
    rows: PunchRow[],
    type: 'flagged_punch' | 'pending_punch' | 'offsite_request',
  ) => {
    const views = await ownerPunchViews(ctx, rows);
    rows.forEach((row, i) => {
      const punch = views[i];
      if (!punch) return;
      items.push({
        id: row.id,
        type,
        createdAt: row.created_at,
        user: who(row.user_id),
        punch,
        map: mapEvidence(row, sites, salon),
      });
    });
  };
  if (wants('flagged_punch')) await punchItems(flagged, 'flagged_punch');
  if (wants('pending_punch')) await punchItems(plain, 'pending_punch');
  if (wants('offsite_request')) await punchItems(offsite, 'offsite_request');

  if (wants('new_device')) {
    for (const d of devices) {
      const previous = await ctx.db.first<{ label: string }>(
        `SELECT label FROM devices WHERE org_id = ?org AND user_id = ? AND status = 'approved'
          ORDER BY approved_at DESC LIMIT 1`,
        d.user_id,
      );
      items.push({
        id: d.id,
        type: 'new_device',
        createdAt: d.requested_at,
        user: who(d.user_id),
        device: deviceView(d),
        replacesDeviceLabel: previous?.label ?? null,
      });
    }
  }

  if (wants('leave_request')) {
    const balances = new Map<string, Awaited<ReturnType<typeof leaveBalances>>>();
    for (const r of leave) {
      let b = balances.get(r.user.id);
      if (!b) {
        b = await leaveBalances(ctx, r.user.id);
        balances.set(r.user.id, b);
      }
      const held = b.find((x) => x.code === r.typeCode);
      // `balance` excludes pending requests; the balance after approval takes this one off.
      const after = held ? Math.max(0, held.balance - r.daysPaid) : 0;
      items.push({
        id: r.id,
        type: 'leave_request',
        createdAt: r.createdAt,
        user: r.user,
        request: r,
        balanceAfter: after,
      });
    }
  }

  if (wants('regularisation')) {
    for (const r of regs) {
      items.push({
        id: r.id,
        type: 'regularisation',
        createdAt: r.createdAt,
        user: r.user,
        request: r,
      });
    }
  }

  if (wants('overtime') && otDays.length > 0) {
    const dates = otDays.map((d) => d.work_date).sort();
    const data = await loadDayData(
      ctx,
      [...new Set(otDays.map((d) => d.user_id))],
      dates[0] as string,
      dates[dates.length - 1] as string,
    );
    for (const d of otDays) {
      const rows = (data.punches.get(`${d.user_id}|${d.work_date}`) ?? []).filter(
        (p) => p.status === 'accepted' || p.status === 'flagged',
      );
      const end = scheduleFrom(data, d.user_id, d.work_date)?.segments.at(-1)?.endTs ?? null;
      items.push({
        id: dayEntityId(d.user_id, d.work_date),
        type: 'overtime',
        createdAt: d.computed_at,
        user: who(d.user_id),
        workDate: d.work_date,
        candidateMin: d.ot_candidate_min,
        preapprovedMin: d.ot_preapproved_min,
        punches: await ownerPunchViews(ctx, rows),
        shiftEnd: end === null ? null : istTime(end),
      });
    }
  }

  if (wants('auto_closed')) {
    for (const p of autoOuts) {
      const opening = await ctx.db.first<{ effective_ts: number }>(
        `SELECT effective_ts FROM punches WHERE org_id = ?org AND user_id = ? AND work_date = ?
            AND kind = 'in' AND status IN ('accepted', 'flagged') AND effective_ts <= ?
          ORDER BY effective_ts DESC LIMIT 1`,
        p.user_id,
        p.work_date,
        p.effective_ts,
      );
      items.push({
        id: p.id,
        type: 'auto_closed',
        createdAt: p.created_at,
        user: who(p.user_id),
        workDate: p.work_date,
        autoOutTs: p.effective_ts,
        inTs: opening?.effective_ts ?? p.effective_ts,
      });
    }
  }

  if (wants('advance_request')) {
    for (const a of advances) {
      const open = await ctx.db.first<{ open: number | null }>(
        `SELECT SUM(a.amount_paise) - COALESCE(SUM(r.recovered), 0) AS open FROM advances a
          LEFT JOIN (SELECT advance_id, SUM(recovered_paise) AS recovered FROM advance_recoveries
                      WHERE org_id = ?org GROUP BY advance_id) r ON r.advance_id = a.id
         WHERE a.org_id = ?org AND a.user_id = ? AND a.status = 'active'`,
        a.user_id,
      );
      items.push({
        id: a.id,
        type: 'advance_request',
        createdAt: a.created_at,
        user: who(a.user_id),
        advance: {
          id: a.id,
          user: who(a.user_id),
          amountPaise: a.amount_paise,
          givenOn: null,
          mode: null,
          reason: a.reason,
          plan: a.plan,
          instalmentsN: a.instalments_n,
          firstMonth: a.first_month,
          status: 'requested',
          staffAck: 'pending',
          staffAckAt: null,
          recoveredPaise: 0,
          balancePaise: a.amount_paise,
          ledger: [],
          createdAt: a.created_at,
        },
        openBalancePaise: open?.open ?? 0,
      });
    }
  }

  if (wants('away')) {
    for (const a of pendingAway) {
      items.push({
        id: a.id,
        type: 'away',
        createdAt: a.end_ts ?? a.created_at,
        user: who(a.user_id),
        userId: a.user_id,
        workDate: a.work_date,
        startTs: a.start_ts,
        endTs: a.end_ts ?? a.start_ts,
        minutes: a.minutes,
        reason: a.reason,
        staffNote: a.staff_note,
        backMissing: a.back_missing === 1,
      });
    }
  }

  const counts = Object.fromEntries(ActionType.options.map((t) => [t, 0])) as Record<
    ActionType,
    number
  >;
  for (const i of items) counts[i.type] += 1;
  const order = (t: ActionType) => ActionType.options.indexOf(t);
  items.sort((a, b) => order(a.type) - order(b.type) || b.createdAt - a.createdAt);
  return { items, counts };
}

/** How many things wait for the owner (the Today card and the app badge). */
export async function actionsCount(ctx: Ctx): Promise<number> {
  const { counts } = await listActions(ctx);
  return Object.values(counts).reduce((s, n) => s + n, 0);
}

// ---- Punch decisions ---------------------------------------------------------------------------

async function assertOpenMonth(ctx: Ctx, workDate: string): Promise<void> {
  const locked = await lockedMonths(ctx, [workDate.slice(0, 7)]);
  if (locked.length > 0) fail('MONTH_LOCKED', `${monthName(workDate)} is closed.`);
}

async function punchOrFail(ctx: Ctx, id: string): Promise<PunchRow> {
  return (await punchById(ctx, id)) ?? fail('NOT_FOUND');
}

/** Looks fine (clear the flag), approve a pending punch, or reject a punch (PRD 4.12). */
export async function reviewPunch(
  ctx: Ctx,
  id: string,
  body: { decision: 'clear' | 'approve' | 'reject'; note?: string | undefined },
): Promise<PunchResult> {
  const row = await punchOrFail(ctx, id);
  await assertOpenMonth(ctx, row.work_date);
  const reject = body.decision === 'reject';
  if (reject && !body.note) {
    fail('VALIDATION', 'Add a reason so they know why.', { field: 'note' });
  }
  const valid =
    body.decision === 'clear'
      ? row.status === 'flagged'
      : body.decision === 'approve'
        ? row.status === 'pending'
        : row.status === 'flagged' || row.status === 'pending' || row.status === 'accepted';
  if (!valid) fail('ALREADY_DECIDED');
  const now = ctx.now();
  const status = reject ? ('rejected' as const) : ('accepted' as const);
  const updated: PunchRow = {
    ...row,
    status,
    pending_reason: reject ? row.pending_reason : null,
    reviewed_by: ctx.user?.id ?? null,
    reviewed_at: now,
    review_note: body.note ?? null,
  };
  await commitDayChange(
    ctx,
    row.user_id,
    row.work_date,
    [
      ctx.db.update(
        'punches',
        {
          status,
          pending_reason: reject ? row.pending_reason : null,
          reviewed_by: ctx.user?.id ?? null,
          reviewed_at: now,
          review_note: body.note ?? null,
        },
        'id = ?',
        row.id,
      ),
      ctx.services.audit.stmt(ctx, {
        category: 'change',
        action: `punch.${body.decision}`,
        entity: 'punch',
        entityId: row.id,
        before: { status: row.status, pendingReason: row.pending_reason },
        after: { status },
        reason: body.note ?? null,
      }),
    ],
    (rows) => rows.map((p) => (p.id === row.id ? updated : p)),
  );
  if (body.decision !== 'clear') {
    ctx.waitUntil(
      safeEmit(ctx, {
        type: 'punch_decided',
        orgId: ctx.orgId as string,
        at: now,
        userId: row.user_id,
        punchId: row.id,
        kind: row.kind,
        effectiveTs: row.effective_ts,
        decision: reject ? 'rejected' : 'approved',
        note: body.note ?? null,
      }),
    );
  }
  return punchResult(ctx, updated);
}

/** Approve, approve and open the venue for others, or reject an "I'm at a venue" punch (PRD 4.6 B). */
export async function decideOffsite(
  ctx: Ctx,
  punchId: string,
  body: {
    decision: 'approve' | 'approve_and_open' | 'reject';
    staffIds?: string[] | undefined;
    note?: string | undefined;
  },
): Promise<PunchResult> {
  const row = await punchOrFail(ctx, punchId);
  if (row.status !== 'pending' || row.pending_reason !== 'offsite_unplanned') {
    fail('ALREADY_DECIDED');
  }
  if (body.decision !== 'approve_and_open') {
    return reviewPunch(ctx, punchId, {
      decision: body.decision === 'reject' ? 'reject' : 'approve',
      note: body.note,
    });
  }
  await assertOpenMonth(ctx, row.work_date);
  if (row.lat === null || row.lng === null) {
    fail('VALIDATION', 'This check-in has no location to use as the venue.', { field: 'location' });
  }
  const now = ctx.now();
  const start = istStartOfDay(row.work_date);
  const duty = await createDutyStmts(
    ctx,
    {
      userIds: [...new Set([row.user_id, ...(body.staffIds ?? [])])],
      workDate: row.work_date,
      startTs: start,
      endTs: start + Math.min(DAY_MS, DUTY_MAX_MS),
      placeName: row.place_name ?? 'Venue',
      location: { lat: row.lat, lng: row.lng },
      radiusM: 200,
      mode: 'geofence',
      otPreapproved: false,
      note: body.note ?? null,
    },
    ctx.user?.id ?? 'system',
  );
  const updated: PunchRow = {
    ...row,
    status: 'accepted',
    pending_reason: null,
    site_id: duty.siteId,
    offsite_duty_id: duty.dutyId,
    reviewed_by: ctx.user?.id ?? null,
    reviewed_at: now,
    review_note: body.note ?? null,
  };
  await commitDayChange(
    ctx,
    row.user_id,
    row.work_date,
    [
      ...duty.stmts,
      ctx.db.update(
        'punches',
        {
          status: 'accepted',
          pending_reason: null,
          site_id: duty.siteId,
          offsite_duty_id: duty.dutyId,
          reviewed_by: ctx.user?.id ?? null,
          reviewed_at: now,
          review_note: body.note ?? null,
        },
        'id = ?',
        row.id,
      ),
      ctx.services.audit.stmt(ctx, {
        category: 'change',
        action: 'punch.approve_and_open',
        entity: 'punch',
        entityId: row.id,
        before: { status: 'pending', pendingReason: 'offsite_unplanned' },
        after: { status: 'accepted', dutyId: duty.dutyId, placeName: row.place_name },
        reason: body.note ?? null,
      }),
    ],
    (rows) => rows.map((p) => (p.id === row.id ? updated : p)),
  );
  ctx.waitUntil(
    safeEmit(ctx, {
      type: 'punch_decided',
      orgId: ctx.orgId as string,
      at: now,
      userId: row.user_id,
      punchId: row.id,
      kind: row.kind,
      effectiveTs: row.effective_ts,
      decision: 'approved',
      note: body.note ?? null,
    }),
  );
  return punchResult(ctx, updated);
}

// ---- Overtime and auto-close ----------------------------------------------------------------------

export async function decideOvertime(
  ctx: Ctx,
  userId: string,
  date: string,
  body: { approvedMin: number; note?: string | undefined },
): Promise<{ approvedMin: number; candidateMin: number }> {
  const data = await loadDayData(ctx, [userId], date, date);
  const c = computeFrom(data, userId, date);
  if (!c) return fail('NOT_FOUND', 'This person has no staff profile.');
  if (c.locked) fail('MONTH_LOCKED', `${monthName(date)} is closed.`);
  const key = dayEntityId(userId, date);
  if (data.otDecisions.has(`${userId}|${date}`)) fail('ALREADY_DECIDED');
  const candidate = c.result.otCandidateMin;
  if (candidate <= 0) fail('CONFLICT', 'There is no overtime waiting on this day.');
  const block = data.settings.overtime.blockMin;
  if (body.approvedMin > candidate || body.approvedMin % block !== 0) {
    fail('VALIDATION', `Approve in steps of ${block} minutes, up to ${candidate}.`, {
      field: 'approvedMin',
    });
  }
  const decision: OtDecisionRow['decision'] =
    body.approvedMin === 0 ? 'rejected' : body.approvedMin === candidate ? 'approved' : 'partial';
  const now = ctx.now();
  const decisionId = ulid(now);
  data.otDecisions.set(`${userId}|${date}`, {
    id: decisionId,
    user_id: userId,
    work_date: date,
    candidate_min: candidate,
    approved_min: body.approvedMin,
    decision,
    decided_by: ctx.user?.id ?? null,
    decided_at: now,
  });
  const plan = await planDay(ctx, userId, date, {}, data);
  await ctx.db.batch([
    ctx.db.insert('ot_decisions', {
      id: decisionId,
      user_id: userId,
      work_date: date,
      candidate_min: candidate,
      approved_min: body.approvedMin,
      decision,
      decided_by: ctx.user?.id ?? null,
      decided_at: now,
      note: body.note ?? null,
    }),
    ctx.services.audit.stmt(ctx, {
      category: 'change',
      action: `overtime.${decision}`,
      entity: 'day',
      entityId: key,
      before: { candidateMin: candidate, status: 'pending' },
      after: { approvedMin: body.approvedMin, decision },
      reason: body.note ?? null,
    }),
    ...plan.stmts,
  ]);
  return { approvedMin: body.approvedMin, candidateMin: candidate };
}

/** Keep the automatic check-out time, or replace it with the real one (PRD 4.8, 4.12). */
export async function decideAutoClose(
  ctx: Ctx,
  userId: string,
  date: string,
  body: { keep: true } | { outTs: number } | { useAwayStart: true },
): Promise<void> {
  // "Use the away start as check-out" (PRD 4.18.6): the open or auto-closed away interval's start.
  if ('useAwayStart' in body) {
    const away = await ctx.db.first<{ start_ts: number }>(
      `SELECT start_ts FROM away_intervals WHERE org_id = ?org AND user_id = ? AND work_date = ?
          AND (end_ts IS NULL OR end_reason = 'auto_close') ORDER BY start_ts DESC LIMIT 1`,
      userId,
      date,
    );
    if (!away) fail('CONFLICT', 'There is no away time to use.');
    return decideAutoClose(ctx, userId, date, { outTs: away.start_ts });
  }
  await assertOpenMonth(ctx, date);
  const auto = await ctx.db.first<PunchRow>(
    `SELECT * FROM punches WHERE org_id = ?org AND user_id = ? AND work_date = ? AND source = 'auto'
        AND kind = 'out' AND status IN ('flagged', 'accepted') AND reviewed_at IS NULL
      ORDER BY created_at DESC LIMIT 1`,
    userId,
    date,
  );
  if (!auto) fail('ALREADY_DECIDED');
  const now = ctx.now();
  if ('keep' in body) {
    const kept: PunchRow = {
      ...auto,
      status: 'accepted',
      reviewed_by: ctx.user?.id ?? null,
      reviewed_at: now,
    };
    await commitDayChange(
      ctx,
      userId,
      date,
      [
        ctx.db.update(
          'punches',
          { status: 'accepted', reviewed_by: ctx.user?.id ?? null, reviewed_at: now },
          'id = ?',
          auto.id,
        ),
        ctx.services.audit.stmt(ctx, {
          category: 'change',
          action: 'punch.auto_close_keep',
          entity: 'punch',
          entityId: auto.id,
          before: { status: auto.status },
          after: { status: 'accepted', effectiveTs: auto.effective_ts },
        }),
      ],
      (rows) => rows.map((p) => (p.id === auto.id ? kept : p)),
    );
    return;
  }
  const opening = await ctx.db.first<{ effective_ts: number }>(
    `SELECT effective_ts FROM punches WHERE org_id = ?org AND user_id = ? AND work_date = ?
        AND kind = 'in' AND status IN ('accepted', 'flagged') ORDER BY effective_ts DESC LIMIT 1`,
    userId,
    date,
  );
  if (opening && body.outTs <= opening.effective_ts) {
    fail('VALIDATION', 'The check-out must be after the check-in.', { field: 'outTs' });
  }
  if (body.outTs > now) fail('VALIDATION', 'That time is in the future.', { field: 'outTs' });
  const replacement = ownerPunchRow(ctx, {
    userId,
    kind: 'out',
    ts: body.outTs,
    workDate: date,
    key: `autoclose:${auto.id}`,
    replaces: auto,
    note: 'Check-out time set by the owner',
  });
  const superseded: PunchRow = { ...auto, status: 'superseded' };
  await commitDayChange(
    ctx,
    userId,
    date,
    [
      ctx.db.update('punches', { status: 'superseded' }, 'id = ?', auto.id),
      insertPunchStmt(ctx, replacement),
      ctx.services.audit.stmt(ctx, {
        category: 'change',
        action: 'punch.auto_close_change',
        entity: 'punch',
        entityId: auto.id,
        before: { effectiveTs: auto.effective_ts },
        after: { effectiveTs: body.outTs, replacementId: replacement.id },
      }),
    ],
    (rows) => [...rows.map((p) => (p.id === auto.id ? superseded : p)), replacement],
  );
}

// ---- Bulk -----------------------------------------------------------------------------------------

type BulkDecideResult = OutputOf<Endpoints['ownerActionsBulk']>;

type BulkBody = {
  type:
    | 'flagged_punch'
    | 'pending_punch'
    | 'leave_request'
    | 'regularisation'
    | 'overtime'
    | 'auto_closed';
  ids: string[];
  decision: 'approve' | 'clear';
};

/** Approve several items of one type; each one stands alone, so one failure never blocks the rest. */
export async function bulkDecide(ctx: Ctx, body: BulkBody): Promise<BulkDecideResult> {
  const done: string[] = [];
  const failed: { id: string; code: string }[] = [];
  for (const id of body.ids) {
    try {
      switch (body.type) {
        case 'flagged_punch':
          await reviewPunch(ctx, id, { decision: 'clear' });
          break;
        case 'pending_punch':
          await reviewPunch(ctx, id, { decision: 'approve' });
          break;
        case 'leave_request':
          await decideLeave(ctx, id, { decision: 'approve' });
          break;
        case 'regularisation':
          await decideRegularisation(ctx, id, { decision: 'approve' });
          break;
        case 'overtime': {
          const [userId, date] = id.split('|');
          if (!userId || !date) fail('VALIDATION', 'Unknown overtime item.');
          const data = await loadDayData(ctx, [userId], date, date);
          const c = computeFrom(data, userId, date);
          await decideOvertime(ctx, userId, date, { approvedMin: c?.result.otCandidateMin ?? 0 });
          break;
        }
        case 'auto_closed': {
          const p = await punchOrFail(ctx, id);
          await decideAutoClose(ctx, p.user_id, p.work_date, { keep: true });
          break;
        }
      }
      done.push(id);
    } catch (e) {
      failed.push({ id, code: isApiException(e) ? e.code : 'INTERNAL' });
    }
  }
  return { done, failed };
}
