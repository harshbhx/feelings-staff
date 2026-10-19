import type { OwnerDayDetail } from '@fs/contracts';
import { fixtures } from '@fs/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { auditChanges, draftFromDay, overrideRequest, shiftTimes } from './day-model';

const day = fixtures.ownerDay as OwnerDayDetail;

describe('Day detail and override (O-05, O-06)', () => {
  it('shows the shift as wall-clock times', () => {
    expect(shiftTimes(day.schedule)).toBe('10:00–20:00');
  });

  it('O-06.1 an override needs a reason', () => {
    const draft = { ...draftFromDay(day.punches), status: 'P' as const };
    expect(overrideRequest(draft, day.day.workDate)).toEqual({ request: null, problem: 'reason' });
    const ok = overrideRequest({ ...draft, reason: 'Was at bridal trial' }, day.day.workDate);
    expect(ok.problem).toBeNull();
    expect(ok.request).toEqual({ status: 'P', reason: 'Was at bridal trial' });
  });

  it('O-06 punch edits become add, edit and delete operations in IST', () => {
    const draft = draftFromDay(day.punches);
    const first = draft.punches[0];
    if (!first) throw new Error('fixture has a punch');
    first.time = '10:00';
    draft.punches.push({ id: null, kind: 'out', time: '20:04', original: null, removed: false });
    const res = overrideRequest({ ...draft, reason: 'Phone had no signal' }, '2026-10-19');
    expect(res.request?.punches).toEqual([
      { op: 'edit', punchId: first.id, ts: Date.parse('2026-10-19T10:00:00+05:30') },
      { op: 'add', kind: 'out', ts: Date.parse('2026-10-19T20:04:00+05:30') },
    ]);
    const removed = draftFromDay(day.punches);
    if (removed.punches[0]) removed.punches[0].removed = true;
    expect(overrideRequest({ ...removed, reason: 'x' }, '2026-10-19').request?.punches).toEqual([
      { op: 'delete', punchId: first.id },
    ]);
  });

  it('refuses an override that changes nothing', () => {
    expect(
      overrideRequest({ ...draftFromDay(day.punches), reason: 'x' }, '2026-10-19').problem,
    ).toBe('nothing');
  });

  it('O-06.2 the audit trail says what changed: status Absent → Present', () => {
    expect(
      auditChanges({ before: { status: 'A', note: null }, after: { status: 'P', note: null } }),
    ).toEqual([{ field: 'status', before: 'A', after: 'P' }]);
  });
});
