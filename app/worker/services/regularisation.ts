/**
 * Regularisation, "fix a day" (PRD 4.11): staff requests, cancellation and the owner's decision,
 * which creates or replaces `owner`-source punches and recomputes the day (S-13). Owner: WP-4.
 */
import {
  addDays,
  istDate,
  istToEpoch,
  type RegularisationCreate,
  type RegularisationKind,
  type RegularisationView,
} from '@fs/contracts';
import { fail } from '../lib/errors';
import { loadOrg } from '../lib/settings';
import { ulid } from '../lib/ulid';
import { personBrief } from './day';
import { DUTY_MARGIN_MS, dutiesBetween } from './duty';
import { lockedMonths, monthName, shortDate } from './leave';
import type { Ctx } from './ports';
import {
  commitDayChange,
  insertPunchStmt,
  ownerPunchRow,
  type PunchRow,
  punchById,
  safeEmit,
} from './punch';

export interface RegularisationRow {
  id: string;
  user_id: string;
  work_date: string;
  kind: RegularisationKind;
  target_punch_id: string | null;
  proposed_in_ts: number | null;
  proposed_out_ts: number | null;
  place_name: string | null;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  decided_by: string | null;
  decided_at: number | null;
  decision_note: string | null;
  created_at: number;
}

interface ViewRow extends RegularisationRow {
  name: string;
  phone_e164: string | null;
  designation: string | null;
  decided_by_name: string | null;
  current_in_ts: number | null;
  current_out_ts: number | null;
}

const VIEW_SELECT = `SELECT r.*, u.name, u.phone_e164, p.designation, d.name AS decided_by_name,
       (SELECT MIN(effective_ts) FROM punches x WHERE x.org_id = r.org_id AND x.user_id = r.user_id
          AND x.work_date = r.work_date AND x.kind = 'in' AND x.status IN ('accepted', 'flagged')) AS current_in_ts,
       (SELECT MAX(effective_ts) FROM punches x WHERE x.org_id = r.org_id AND x.user_id = r.user_id
          AND x.work_date = r.work_date AND x.kind = 'out' AND x.status IN ('accepted', 'flagged')) AS current_out_ts
  FROM regularisations r
  JOIN users u ON u.id = r.user_id
  LEFT JOIN staff_profiles p ON p.user_id = r.user_id
  LEFT JOIN users d ON d.id = r.decided_by`;

function view(r: ViewRow): RegularisationView {
  return {
    id: r.id,
    user: personBrief(r),
    workDate: r.work_date,
    kind: r.kind,
    targetPunchId: r.target_punch_id,
    proposedInTs: r.proposed_in_ts,
    proposedOutTs: r.proposed_out_ts,
    currentInTs: r.current_in_ts,
    currentOutTs: r.current_out_ts,
    placeName: r.place_name,
    reason: r.reason,
    status: r.status,
    decidedAt: r.decided_at,
    decidedByName: r.decided_by_name,
    decisionNote: r.decision_note,
    createdAt: r.created_at,
  };
}

export async function regularisationViews(
  ctx: Ctx,
  where: string,
  ...params: (string | number)[]
): Promise<RegularisationView[]> {
  const rows = await ctx.db.all<ViewRow>(
    `${VIEW_SELECT} WHERE r.org_id = ?org AND (${where}) ORDER BY r.work_date DESC, r.created_at DESC`,
    ...params,
  );
  return rows.map(view);
}

export async function regularisationView(ctx: Ctx, id: string): Promise<RegularisationView> {
  const [v] = await regularisationViews(ctx, 'r.id = ?', id);
  return v ?? fail('NOT_FOUND');
}

async function row(ctx: Ctx, id: string): Promise<RegularisationRow> {
  const r = await ctx.db.first<RegularisationRow>(
    'SELECT * FROM regularisations WHERE org_id = ?org AND id = ?',
    id,
  );
  return r ?? fail('NOT_FOUND');
}

/** Times must fall within 04:00-23:59 of the work date, or inside a duty window (PRD 4.11). */
async function checkTimes(
  ctx: Ctx,
  userId: string,
  workDate: string,
  times: (number | null | undefined)[],
): Promise<void> {
  const lo = istToEpoch(workDate, '04:00');
  const hi = istToEpoch(workDate, '23:59') + 59_999;
  const duties = await dutiesBetween(ctx, workDate, workDate, userId);
  for (const t of times) {
    if (t === null || t === undefined) continue;
    const inDuty = duties.some(
      (d) => t >= d.start_ts - DUTY_MARGIN_MS && t <= d.end_ts + DUTY_MARGIN_MS,
    );
    if ((t < lo || t > hi) && !inDuty) {
      fail('VALIDATION', 'Pick a time between 04:00 and 23:59 on that day.', { field: 'time' });
    }
  }
}

/** Staff: ask to fix a day (PRD 4.11, S-13.1, S-13.2). */
export async function createRegularisation(
  ctx: Ctx,
  body: RegularisationCreate,
): Promise<RegularisationView> {
  const user = ctx.user ?? fail('UNAUTHENTICATED');
  const { org, settings } = await loadOrg(ctx);
  const owner = org.owner_display_name;
  const now = ctx.now();
  const today = istDate(now);
  const window = settings.attendance.regularisationWindowDays;
  if (body.workDate > today || body.workDate < addDays(today, -window)) {
    fail(
      'RULE_VIOLATION',
      `You can fix days from the last ${window} days. Ask ${owner} for older ones.`,
      {
        reason: 'window',
      },
    );
  }
  const locked = await lockedMonths(ctx, [body.workDate.slice(0, 7)]);
  if (locked.length > 0) {
    fail('MONTH_LOCKED', `${monthName(body.workDate)} is closed. Ask ${owner}.`);
  }
  let target: PunchRow | null = null;
  switch (body.kind) {
    case 'missed_in':
      if (body.proposedInTs === undefined)
        fail('VALIDATION', 'When did you arrive?', { field: 'proposedInTs' });
      break;
    case 'missed_out':
      if (body.proposedOutTs === undefined)
        fail('VALIDATION', 'When did you leave?', { field: 'proposedOutTs' });
      break;
    case 'wrong_time': {
      target = body.targetPunchId ? await punchById(ctx, body.targetPunchId) : null;
      if (
        !target ||
        target.user_id !== user.id ||
        target.work_date !== body.workDate ||
        target.status === 'rejected' ||
        target.status === 'superseded'
      ) {
        fail('VALIDATION', 'Pick the check-in or check-out that is wrong.', {
          field: 'targetPunchId',
        });
      }
      const ts = target.kind === 'in' ? body.proposedInTs : body.proposedOutTs;
      if (ts === undefined) fail('VALIDATION', 'What is the right time?', { field: 'time' });
      break;
    }
    case 'offsite_unplanned':
      if (!body.placeName) fail('VALIDATION', 'Where did you work?', { field: 'placeName' });
      if (body.proposedInTs === undefined || body.proposedOutTs === undefined) {
        fail('VALIDATION', 'Add the times you started and finished.', { field: 'time' });
      }
      break;
  }
  if (
    body.proposedInTs !== undefined &&
    body.proposedOutTs !== undefined &&
    body.proposedOutTs <= body.proposedInTs
  ) {
    fail('VALIDATION', 'The time you left must be after the time you arrived.', {
      field: 'proposedOutTs',
    });
  }
  await checkTimes(ctx, user.id, body.workDate, [body.proposedInTs, body.proposedOutTs]);
  const open = await ctx.db.first<{ id: string }>(
    "SELECT id FROM regularisations WHERE org_id = ?org AND user_id = ? AND work_date = ? AND status = 'pending'",
    user.id,
    body.workDate,
  );
  if (open) fail('CONFLICT', 'You already asked to fix this day.', { reason: 'open_request' });

  const id = ulid(now);
  try {
    await ctx.db.batch([
      ctx.db.insert('regularisations', {
        id,
        user_id: user.id,
        work_date: body.workDate,
        kind: body.kind,
        target_punch_id: target?.id ?? null,
        proposed_in_ts: body.proposedInTs ?? null,
        proposed_out_ts: body.proposedOutTs ?? null,
        place_name: body.placeName ?? null,
        reason: body.reason,
        status: 'pending',
        created_at: now,
      }),
      ctx.services.audit.stmt(ctx, {
        category: 'change',
        action: 'regularisation.request',
        entity: 'regularisation',
        entityId: id,
        after: body,
      }),
    ]);
  } catch (e) {
    if (e instanceof Error && e.message.includes('UNIQUE')) {
      fail('CONFLICT', 'You already asked to fix this day.', { reason: 'open_request' });
    }
    throw e;
  }
  ctx.waitUntil(
    safeEmit(ctx, {
      type: 'regularisation_requested',
      orgId: ctx.orgId as string,
      at: now,
      userId: user.id,
      name: user.name,
      requestId: id,
      workDate: body.workDate,
      kind: body.kind,
      proposedInTs: body.proposedInTs ?? null,
      proposedOutTs: body.proposedOutTs ?? null,
    }),
  );
  return regularisationView(ctx, id);
}

export async function cancelRegularisation(ctx: Ctx, id: string): Promise<RegularisationView> {
  const user = ctx.user ?? fail('UNAUTHENTICATED');
  const r = await row(ctx, id);
  if (r.user_id !== user.id) fail('NOT_FOUND');
  if (r.status !== 'pending') fail('ALREADY_DECIDED', 'This request is already closed.');
  await ctx.db.batch([
    ctx.db.update('regularisations', { status: 'cancelled' }, "id = ? AND status = 'pending'", id),
    ctx.services.audit.stmt(ctx, {
      category: 'change',
      action: 'regularisation.cancel',
      entity: 'regularisation',
      entityId: id,
      before: { status: 'pending' },
      after: { status: 'cancelled' },
    }),
  ]);
  return regularisationView(ctx, id);
}

/**
 * Owner decides (PRD 4.11, S-13.3): approval creates or replaces punches with `source = owner`,
 * recomputes the day and writes audit rows; it never approves overtime by itself.
 */
export async function decideRegularisation(
  ctx: Ctx,
  id: string,
  body: {
    decision: 'approve' | 'reject';
    note?: string | undefined;
    adjustedTimes?: { inTs?: number | undefined; outTs?: number | undefined } | undefined;
  },
): Promise<RegularisationView> {
  const r = await row(ctx, id);
  if (r.status !== 'pending') fail('ALREADY_DECIDED');
  if (body.decision === 'reject' && !body.note) {
    fail('VALIDATION', 'Add a reason so they know why.', { field: 'note' });
  }
  const locked = await lockedMonths(ctx, [r.work_date.slice(0, 7)]);
  if (locked.length > 0) fail('MONTH_LOCKED', `${monthName(r.work_date)} is closed.`);
  const now = ctx.now();
  const approve = body.decision === 'approve';
  const decision = ctx.db.update(
    'regularisations',
    {
      status: approve ? 'approved' : 'rejected',
      decided_by: ctx.user?.id ?? null,
      decided_at: now,
      decision_note: body.note ?? null,
    },
    "id = ? AND status = 'pending'",
    id,
  );
  const decisionAudit = ctx.services.audit.stmt(ctx, {
    category: 'change',
    action: approve ? 'regularisation.approve' : 'regularisation.reject',
    entity: 'regularisation',
    entityId: id,
    before: { status: 'pending' },
    after: { status: approve ? 'approved' : 'rejected', adjustedTimes: body.adjustedTimes ?? null },
    reason: body.note ?? null,
  });

  if (!approve) {
    await ctx.db.batch([decision, decisionAudit]);
  } else {
    const inTs = body.adjustedTimes?.inTs ?? r.proposed_in_ts;
    const outTs = body.adjustedTimes?.outTs ?? r.proposed_out_ts;
    await checkTimes(ctx, r.user_id, r.work_date, [inTs, outTs]);
    const key = (k: string) => `reg:${r.id}:${k}`;
    const added: PunchRow[] = [];
    let replaced: PunchRow | null = null;
    const make = (kind: 'in' | 'out', ts: number, replaces: PunchRow | null = null) =>
      ownerPunchRow(ctx, {
        userId: r.user_id,
        kind,
        ts,
        workDate: r.work_date,
        key: key(kind),
        replaces,
        placeName: r.place_name,
        note: r.reason,
      });
    if (r.kind === 'missed_in' && inTs !== null) added.push(make('in', inTs));
    if (r.kind === 'missed_out' && outTs !== null) added.push(make('out', outTs));
    if (r.kind === 'offsite_unplanned' && inTs !== null && outTs !== null) {
      added.push(make('in', inTs), make('out', outTs));
    }
    if (r.kind === 'wrong_time') {
      replaced = r.target_punch_id ? await punchById(ctx, r.target_punch_id) : null;
      if (!replaced || replaced.status === 'superseded' || replaced.status === 'rejected') {
        fail('CONFLICT', 'That punch changed in the meantime.', { reason: 'target_changed' });
      }
      const ts = replaced.kind === 'in' ? inTs : outTs;
      if (ts === null) fail('VALIDATION', 'The corrected time is missing.', { field: 'time' });
      added.push(make(replaced.kind === 'in' ? 'in' : 'out', ts, replaced));
    }
    const target = replaced;
    const changes: D1PreparedStatement[] = [decision];
    if (target) {
      changes.push(
        ctx.db.update('punches', { status: 'superseded' }, 'id = ?', target.id),
        ctx.services.audit.stmt(ctx, {
          category: 'change',
          action: 'punch.supersede',
          entity: 'punch',
          entityId: target.id,
          before: { effectiveTs: target.effective_ts, status: target.status },
          after: { status: 'superseded' },
          reason: `Fix approved: ${r.reason}`,
        }),
      );
    }
    for (const p of added) {
      changes.push(
        insertPunchStmt(ctx, p),
        ctx.services.audit.stmt(ctx, {
          category: 'change',
          action: 'punch.create_owner',
          entity: 'punch',
          entityId: p.id,
          after: {
            kind: p.kind,
            effectiveTs: p.effective_ts,
            source: 'owner',
            regularisationId: r.id,
          },
          reason: r.reason,
        }),
      );
    }
    changes.push(decisionAudit);
    await commitDayChange(ctx, r.user_id, r.work_date, changes, (rows) => [
      ...rows.map((x) =>
        target && x.id === target.id ? { ...x, status: 'superseded' as const } : x,
      ),
      ...added,
    ]);
  }
  ctx.waitUntil(
    safeEmit(ctx, {
      type: 'regularisation_decided',
      orgId: ctx.orgId as string,
      at: now,
      userId: r.user_id,
      requestId: id,
      workDate: r.work_date,
      decision: approve ? 'approved' : 'rejected',
      note: body.note ?? null,
    }),
  );
  return regularisationView(ctx, id);
}

/** For copy: "Priya asked to fix 14 Oct". */
export const regularisationLabel = (r: Pick<RegularisationRow, 'work_date'>) =>
  `fix ${shortDate(r.work_date)}`;
