import type { RosterView } from '@fs/contracts';
import { fixtures } from '@fs/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { swapChanges, swapTargets, weeklyHours, weekNav } from './roster-model';

const view = fixtures.ownerRosterGet as RosterView;
const neha = view.rows.find((r) => r.user.name.startsWith('Neha'));
if (!neha) throw new Error('roster fixture has Neha');

describe('Roster model (O-08)', () => {
  it('O-08.1 the week has seven days per person with templates, WO, HO and leave', () => {
    expect(view.dates).toHaveLength(7);
    const kinds = new Set(view.rows.flatMap((r) => r.cells.map((c) => c.kind)));
    for (const k of ['template', 'WO', 'HO', 'L']) expect(kinds.has(k as never)).toBe(true);
  });

  it('O-08.2 swapping a week-off is two changes: the off day works, the work day is off', () => {
    const off = neha.cells.find((c) => c.kind === 'WO');
    const work = swapTargets(neha).find((c) => c.date > (off?.date ?? ''));
    if (!off || !work) throw new Error('fixture has a week-off and a later work day');
    const changes = swapChanges(neha, off.date, work.date);
    expect(changes).toEqual([
      { userId: neha.user.id, date: off.date, kind: 'template', templateId: work.templateId },
      { userId: neha.user.id, date: work.date, kind: 'week_off' },
    ]);
  });

  it('refuses to swap with a holiday or a leave day', () => {
    const off = neha.cells.find((c) => c.kind === 'WO');
    const holiday = neha.cells.find((c) => c.kind === 'HO');
    if (!off || !holiday) throw new Error('fixture has both');
    expect(() => swapChanges(neha, off.date, holiday.date)).toThrow();
  });

  it('O-08.3 weekly hours come from the scheduled minutes', () => {
    expect(weeklyHours({ ...neha, scheduledMin: 52 * 60 })).toBe(52);
  });

  it('pages a week at a time across the year boundary', () => {
    expect(weekNav('2026-W43')).toEqual({ prev: '2026-W42', next: '2026-W44' });
    expect(weekNav('2026-W01').prev).toBe('2025-W52');
  });
});
