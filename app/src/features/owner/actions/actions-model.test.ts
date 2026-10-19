import type { ActionsView } from '@fs/contracts';
import { fixtures, variants } from '@fs/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import {
  canBulk,
  clampOvertime,
  filterChips,
  groupActions,
  openActionCount,
  overtimeSteps,
  TYPE_ORDER,
  toggleSelected,
  waitingDays,
} from './actions-model';

const view = fixtures.ownerActions as ActionsView;
const empty = variants.ownerActions?.empty as ActionsView;

describe('Needs action model (O-04)', () => {
  it('O-04.1 every item type in PRD 4.12 appears, grouped in a fixed order', () => {
    const groups = groupActions(view.items, null);
    expect(groups.map((g) => g.type)).toEqual(TYPE_ORDER.filter((t) => view.counts[t]));
    expect(new Set(view.items.map((i) => i.type)).size).toBe(9);
  });

  it('O-04.1 a filter chip shows one type only', () => {
    const groups = groupActions(view.items, 'leave_request');
    expect(groups).toHaveLength(1);
    expect(groups[0]?.items.every((i) => i.type === 'leave_request')).toBe(true);
    expect(filterChips(view).every((c) => c.count > 0)).toBe(true);
  });

  it('O-04.3 bulk approve is allowed for same-type items except devices', () => {
    expect(canBulk('new_device')).toBe(false);
    expect(canBulk('offsite_request')).toBe(false);
    expect(canBulk('leave_request')).toBe(true);
    const leave = view.items.find((i) => i.type === 'leave_request');
    const device = view.items.find((i) => i.type === 'new_device');
    const flagged = view.items.find((i) => i.type === 'flagged_punch');
    if (!leave || !device || !flagged) throw new Error('fixture covers every type');
    let sel = toggleSelected({ type: null, ids: new Set() }, leave);
    expect(sel).toEqual({ type: 'leave_request', ids: new Set([leave.id]) });
    sel = toggleSelected(sel, device);
    expect(sel.ids.has(device.id)).toBe(false);
    sel = toggleSelected(sel, flagged);
    expect(sel).toEqual({ type: 'flagged_punch', ids: new Set([flagged.id]) });
    sel = toggleSelected(sel, flagged);
    expect(sel).toEqual({ type: null, ids: new Set() });
  });

  it('O-04.4 the count badge equals the number of open items', () => {
    expect(openActionCount(view)).toBe(view.items.length);
    expect(openActionCount(empty)).toBe(0);
    expect(openActionCount(undefined)).toBe(0);
  });

  it('overtime part approval moves in 15-minute blocks up to the candidate', () => {
    expect(overtimeSteps(60)).toEqual([15, 30, 45, 60]);
    expect(clampOvertime(70, 60)).toBe(60);
    expect(clampOvertime(5, 60)).toBe(15);
    expect(clampOvertime(38, 60)).toBe(45);
  });

  it('marks items waiting more than 48 hours, without nagging newer ones', () => {
    const now = Date.parse('2026-10-19T10:42:00+05:30');
    expect(waitingDays(now - 47 * 3_600_000, now)).toBe(0);
    expect(waitingDays(now - 72 * 3_600_000, now)).toBe(3);
  });
});
