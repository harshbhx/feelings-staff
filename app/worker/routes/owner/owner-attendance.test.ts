/**
 * WP-4 owner attendance API (PRD 4.12, 5.2; O-03 to O-06, S-04.5): the Today board, the
 * Needs-action queue and its decisions, the register, the day detail and the owner override.
 * Rows are written straight into D1 so each case controls exactly what the engine sees.
 */
import type {
  ActionsView,
  BulkDecideResult as BulkDecideResultSchema,
  Endpoints,
  OutputOf,
  OwnerDayDetail,
  PunchResult,
  RegisterView,
  TodayBoard,
} from '@fs/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { setServiceOverridesForTests } from '../../services/registry';
import { fakeNotifier } from '../../test/fakes';
import { callJson, sessionFor, testEnv } from '../../test/helpers';
import { addPunch, addUser, ctxAt, DAY, ist, newSalon, type Salon } from '../../test/notify-kit';
import { setClock } from '../auth/test/kit';

type BulkDecideResult = z.infer<typeof BulkDecideResultSchema>;
type OvertimeResult = OutputOf<Endpoints['ownerOvertimeDecide']>;

let salon: Salon;
let owner: string;
let notifier: ReturnType<typeof fakeNotifier>;

beforeEach(async () => {
  salon = await newSalon();
  owner = await sessionFor(salon.ownerId);
  notifier = fakeNotifier();
  setServiceOverridesForTests({ notifier });
  await setClock(ist('13:00'));
});

afterEach(async () => {
  setServiceOverridesForTests(null);
  await setClock(null);
});

const audit = async (action: string) =>
  (
    await testEnv.DB.prepare(
      'SELECT action, entity, entity_id, reason FROM audit_log WHERE action = ?1',
    )
      .bind(action)
      .all<{ action: string; entity: string; entity_id: string; reason: string | null }>()
  ).results;

async function setStatus(punchId: string, status: string, reason: string | null = null) {
  await testEnv.DB.prepare('UPDATE punches SET status = ?2, pending_reason = ?3 WHERE id = ?1')
    .bind(punchId, status, reason)
    .run();
}

async function recompute(userId: string) {
  const ctx = await ctxAt(salon, ist('22:00'));
  await ctx.services.days.recompute(ctx, userId, DAY);
}

const get = <T>(path: string) => callJson<T>('GET', path, { cookie: owner });
const post = <T>(path: string, body: unknown) => callJson<T>('POST', path, { cookie: owner, body });

describe('O-03 Today board', () => {
  it('O-03.1 counters match the day: in, late, not in yet, checked out', async () => {
    const priya = await addUser(salon, { name: 'Priya Shah' });
    const neha = await addUser(salon, { name: 'Neha Parmar' });
    const kajal = await addUser(salon, { name: 'Kajal Solanki' });
    await addPunch(salon, priya, 'in', ist('10:25'));
    await addPunch(salon, neha, 'in', ist('09:58'));
    await addPunch(salon, neha, 'out', ist('12:30'));
    const { status, body } = await get<TodayBoard>('/owner/today');
    expect(status).toBe(200);
    expect(body.date).toBe(DAY);
    expect(body.in.map((r) => r.user.name)).toEqual(['Priya Shah']);
    expect(body.in[0]?.lateMin).toBe(25);
    expect(body.out.map((r) => r.user.name)).toEqual(['Neha Parmar']);
    expect(body.notIn.map((r) => r.user.id)).toEqual([kajal]);
    expect(body.notIn[0]?.state).toBe('not_in_yet');
    expect(body.notIn[0]?.minutesLate).toBe(180);
    expect(body.counters).toMatchObject({
      present: 2,
      late: 1,
      notInYet: 1,
      checkedOut: 1,
    });
    expect(body.firstShiftStart).toBe('10:00');
  });

  it('O-03.1 a person on a week off is away, not missing', async () => {
    const dow = new Date(`${DAY}T00:00:00Z`).getUTCDay();
    const rani = await addUser(salon, { name: 'Rani Joshi', weekOffDow: dow });
    const { body } = await get<TodayBoard>('/owner/today');
    expect(body.away).toEqual([expect.objectContaining({ reason: 'week_off' })]);
    expect(body.away[0]?.user.id).toBe(rani);
    expect(body.counters.weekOff).toBe(1);
    expect(body.notIn).toEqual([]);
  });
});

describe('O-04 Needs action', () => {
  it('O-04.1 lists flagged and pending punches with evidence, grouped by type', async () => {
    const priya = await addUser(salon, { name: 'Priya Shah' });
    const flagged = await addPunch(salon, priya, 'in', ist('10:02'), { status: 'flagged' });
    const neha = await addUser(salon, { name: 'Neha Parmar' });
    const pending = await addPunch(salon, neha, 'in', ist('10:05'), { status: 'pending' });
    await setStatus(pending, 'pending', 'outside_fence');
    const { status, body } = await get<ActionsView>('/owner/actions');
    expect(status).toBe(200);
    expect(body.items.map((i) => [i.type, i.id])).toEqual([
      ['flagged_punch', flagged],
      ['pending_punch', pending],
    ]);
    expect(body.counts.flagged_punch).toBe(1);
    expect(body.counts.pending_punch).toBe(1);
    expect(body.counts.leave_request).toBe(0);
    const filtered = await get<ActionsView>('/owner/actions?type=pending_punch');
    expect(filtered.body.items).toHaveLength(1);
  });

  it('O-04.4 the badge count equals the number of open items', async () => {
    const priya = await addUser(salon, { name: 'Priya Shah' });
    await addPunch(salon, priya, 'in', ist('10:02'), { status: 'flagged' });
    const neha = await addUser(salon, { name: 'Neha Parmar' });
    const p = await addPunch(salon, neha, 'in', ist('10:05'));
    await setStatus(p, 'pending', 'outside_fence');
    const actions = await get<ActionsView>('/owner/actions');
    const board = await get<TodayBoard>('/owner/today');
    expect(board.body.actionsCount).toBe(actions.body.items.length);
    expect(board.body.actionsCount).toBe(2);
  });

  it('O-04.2 Looks fine clears the flag and writes an audit row', async () => {
    const priya = await addUser(salon, { name: 'Priya Shah' });
    const id = await addPunch(salon, priya, 'in', ist('10:02'), { status: 'flagged' });
    const res = await post<PunchResult>(`/owner/punches/${id}/review`, { decision: 'clear' });
    expect(res.status).toBe(200);
    expect(res.body.punch.status).toBe('accepted');
    expect(await audit('punch.clear')).toHaveLength(1);
    const again = await post<unknown>(`/owner/punches/${id}/review`, { decision: 'clear' });
    expect(again.status).toBe(409);
    expect((await get<ActionsView>('/owner/actions')).body.items).toEqual([]);
  });

  it('O-04.2 approving a pending punch tells the staff member and counts the day', async () => {
    const priya = await addUser(salon, { name: 'Priya Shah' });
    const id = await addPunch(salon, priya, 'in', ist('10:02'));
    await setStatus(id, 'pending', 'outside_fence');
    const res = await post<PunchResult>(`/owner/punches/${id}/review`, { decision: 'approve' });
    expect(res.status).toBe(200);
    expect(res.body.punch.status).toBe('accepted');
    expect(res.body.day.firstInTs).toBe(ist('10:02'));
    expect(notifier.events.map((e) => e.type)).toContain('punch_decided');
    expect(await audit('punch.approve')).toHaveLength(1);
  });

  it('O-04.2 rejecting needs a reason, then removes the punch from the day', async () => {
    const priya = await addUser(salon, { name: 'Priya Shah' });
    const id = await addPunch(salon, priya, 'in', ist('10:02'), { status: 'flagged' });
    const bad = await callJson('POST', `/owner/punches/${id}/review`, {
      cookie: owner,
      body: { decision: 'reject' },
    });
    expect(bad.status).toBe(400);
    const res = await post<PunchResult>(`/owner/punches/${id}/review`, {
      decision: 'reject',
      note: 'Not at the salon',
    });
    expect(res.status).toBe(200);
    expect(res.body.punch.status).toBe('rejected');
    expect(res.body.day.firstInTs).toBeNull();
    const event = notifier.events.find((e) => e.type === 'punch_decided');
    expect(event).toMatchObject({ decision: 'rejected', note: 'Not at the salon' });
    expect((await audit('punch.reject'))[0]?.reason).toBe('Not at the salon');
  });

  it('O-04.3 bulk approve works for same-type items and reports each failure', async () => {
    const a = await addUser(salon, { name: 'Priya Shah' });
    const b = await addUser(salon, { name: 'Neha Parmar' });
    const p1 = await addPunch(salon, a, 'in', ist('10:01'), { status: 'flagged' });
    const p2 = await addPunch(salon, b, 'in', ist('10:03'), { status: 'flagged' });
    const res = await post<BulkDecideResult>('/owner/actions/bulk', {
      type: 'flagged_punch',
      ids: [p1, p2, 'does-not-exist'],
      decision: 'clear',
    });
    expect(res.status).toBe(200);
    expect(res.body.done.sort()).toEqual([p1, p2].sort());
    expect(res.body.failed).toEqual([{ id: 'does-not-exist', code: 'NOT_FOUND' }]);
  });

  it('O-04.1 overtime waits for a decision; approving part stores minutes in blocks', async () => {
    const priya = await addUser(salon, { name: 'Priya Shah' });
    await addPunch(salon, priya, 'in', ist('10:00'));
    await addPunch(salon, priya, 'out', ist('21:00'));
    await setClock(ist('22:00'));
    await recompute(priya);
    const first = await post<unknown>(`/owner/days/${priya}/${DAY}/auto-close`, { keep: true });
    expect(first.status).toBe(409);
    const list = await get<ActionsView>('/owner/actions?type=overtime');
    expect(list.body.items).toHaveLength(1);
    const item = list.body.items[0];
    expect(item).toMatchObject({ type: 'overtime', workDate: DAY, shiftEnd: '20:00' });
    expect(item?.type === 'overtime' ? item.candidateMin : 0).toBe(60);
    const odd = await post<unknown>(`/owner/overtime/${priya}/${DAY}/decide`, { approvedMin: 20 });
    expect(odd.status).toBe(400);
    const res = await post<OvertimeResult>(`/owner/overtime/${priya}/${DAY}/decide`, {
      approvedMin: 30,
    });
    expect(res.body).toEqual({ approvedMin: 30, candidateMin: 60 });
    const day = await get<OwnerDayDetail>(`/owner/days/${priya}/${DAY}`);
    expect(day.body.day).toMatchObject({ otStatus: 'partial', otApprovedMin: 30 });
    expect((await audit('overtime.partial'))[0]?.entity_id).toBe(`${priya}|${DAY}`);
    const twice = await post<unknown>(`/owner/overtime/${priya}/${DAY}/decide`, { approvedMin: 0 });
    expect(twice.status).toBe(409);
  });

  it('O-04.1 an auto-closed day keeps the automatic time or takes the real one', async () => {
    const priya = await addUser(salon, { name: 'Priya Shah' });
    await addPunch(salon, priya, 'in', ist('10:00'));
    const autoId = await addPunch(salon, priya, 'out', ist('20:00'), {
      source: 'auto',
      status: 'flagged',
    });
    await setClock(ist('22:00'));
    const list = await get<ActionsView>('/owner/actions?type=auto_closed');
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({
      type: 'auto_closed',
      id: autoId,
      autoOutTs: ist('20:00'),
      inTs: ist('10:00'),
    });
    const res = await post<OwnerDayDetail>(`/owner/days/${priya}/${DAY}/auto-close`, {
      outTs: ist('18:30'),
    });
    expect(res.status).toBe(200);
    expect(res.body.day.lastOutTs).toBe(ist('18:30'));
    expect((await get<ActionsView>('/owner/actions')).body.items).toEqual([]);
    expect(await audit('punch.auto_close_change')).toHaveLength(1);
  });
});

describe('O-05 Register and day detail', () => {
  it('O-05.1 the grid has a cell for every staff member and day, with totals', async () => {
    const priya = await addUser(salon, { name: 'Priya Shah' });
    await addPunch(salon, priya, 'in', ist('10:00'));
    await addPunch(salon, priya, 'out', ist('20:00'));
    const { status, body } = await get<RegisterView>('/owner/register?month=2026-10');
    expect(status).toBe(200);
    expect(body.dates).toHaveLength(31);
    expect(body.locked).toBe(false);
    const row = body.rows.find((r) => r.user.id === priya);
    expect(row?.cells).toHaveLength(31);
    const today = row?.cells[18];
    expect(today).toMatchObject({ status: 'P', future: false, inTs: ist('10:00') });
    expect(row?.cells[25]?.future).toBe(true);
    expect(row?.totals.present).toBe(1);
  });

  it('O-05.3 day detail shows punches, schedule, pay lines and the audit trail', async () => {
    const priya = await addUser(salon, { name: 'Priya Shah' });
    await addPunch(salon, priya, 'in', ist('10:25'));
    const { status, body } = await get<OwnerDayDetail>(`/owner/days/${priya}/${DAY}`);
    expect(status).toBe(200);
    expect(body.user.name).toBe('Priya Shah');
    expect(body.punches).toHaveLength(1);
    expect(body.schedule.dayType).toBe('work');
    expect(body.lines.some((l) => l.code === 'late')).toBe(true);
    expect(body.audit).toEqual([]);
    expect(body.locked).toBe(false);
  });

  it('O-05.3 an unknown person is not found', async () => {
    const res = await get<unknown>(`/owner/days/01JAAAAAAAAAAAAAAAAAAAAAAA/${DAY}`);
    expect(res.status).toBe(404);
  });
});

describe('O-06 Owner override', () => {
  it('O-06.1 an override needs a reason', async () => {
    const priya = await addUser(salon, { name: 'Priya Shah' });
    const res = await callJson('PUT', `/owner/days/${priya}/${DAY}/override`, {
      cookie: owner,
      body: { status: 'P' },
    });
    expect(res.status).toBe(400);
  });

  it('O-06.2 sets the day status and leaves the history on the day', async () => {
    const priya = await addUser(salon, { name: 'Priya Shah' });
    await setClock(ist('22:00'));
    const res = await callJson<OwnerDayDetail>('PUT', `/owner/days/${priya}/${DAY}/override`, {
      cookie: owner,
      body: { status: 'P', reason: 'Was at a bridal trial, I asked her to' },
    });
    expect(res.status).toBe(200);
    expect(res.body.day.status).toBe('P');
    expect(res.body.day.tags).toContain('edited');
    const entry = res.body.audit.find((a) => a.action === 'day.override');
    expect(entry).toMatchObject({
      reason: 'Was at a bridal trial, I asked her to',
      entity: 'day',
    });
  });

  it('O-06.2 adds, edits and deletes punches; replaced punches are kept as history', async () => {
    const priya = await addUser(salon, { name: 'Priya Shah' });
    const inId = await addPunch(salon, priya, 'in', ist('10:40'));
    const stray = await addPunch(salon, priya, 'in', ist('11:00'));
    const res = await callJson<OwnerDayDetail>('PUT', `/owner/days/${priya}/${DAY}/override`, {
      cookie: owner,
      body: {
        reason: 'Phone was dead, she came at 10:05',
        punches: [
          { op: 'edit', punchId: inId, ts: ist('10:05') },
          { op: 'delete', punchId: stray },
          { op: 'add', kind: 'out', ts: ist('12:30') },
        ],
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.punches.map((p) => [p.kind, p.effectiveTs, p.edited])).toEqual([
      ['in', ist('10:05'), true],
      ['out', ist('12:30'), true],
    ]);
    expect(res.body.day.lateMin).toBe(5);
    const actions = (
      await testEnv.DB.prepare("SELECT action FROM audit_log WHERE action LIKE 'punch.%'").all<{
        action: string;
      }>()
    ).results.map((r) => r.action);
    expect(actions).toEqual(
      expect.arrayContaining(['punch.edit', 'punch.delete', 'punch.create_owner']),
    );
  });

  it('O-06.1 a punch in the future is refused', async () => {
    const priya = await addUser(salon, { name: 'Priya Shah' });
    const res = await callJson('PUT', `/owner/days/${priya}/${DAY}/override`, {
      cookie: owner,
      body: { reason: 'Test', punches: [{ op: 'add', kind: 'in', ts: ist('18:00') }] },
    });
    expect(res.status).toBe(400);
  });

  it('O-06.3 a finalised month refuses overrides', async () => {
    const priya = await addUser(salon, { name: 'Priya Shah' });
    await testEnv.DB.prepare(
      `INSERT INTO payroll_runs (id, org_id, month, revision, status, settings_snapshot_json, engine_version, created_by, created_at)
       VALUES ('run1', ?1, '2026-10', 1, 'finalised', '{}', 'test', ?2, 1)`,
    )
      .bind(salon.orgId, salon.ownerId)
      .run();
    const res = await callJson<{ error: { code: string } }>(
      'PUT',
      `/owner/days/${priya}/${DAY}/override`,
      { cookie: owner, body: { status: 'P', reason: 'Late fix' } },
    );
    expect(res.body.error.code).toBe('MONTH_LOCKED');
  });
});
