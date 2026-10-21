import { describe, expect, it } from 'vitest';
import { STEPS, setupLayout, setupProgress } from './setup-model';

describe('Setup checklist (O-02)', () => {
  it('O-02.3 a skipped step counts as handled and the next open step is offered', () => {
    expect(setupProgress({ salon: 'done', location: 'skipped' })).toEqual({
      handled: 2,
      total: STEPS.length,
      next: 'shifts',
    });
  });

  it('O-02.3 a skipped step can be reopened later: it is offered again once set back to todo', () => {
    expect(setupProgress({ salon: 'done', location: 'todo' }).next).toBe('location');
    const all = Object.fromEntries(STEPS.map((s) => [s, 'done'])) as Record<string, 'done'>;
    expect(setupProgress(all)).toEqual({ handled: STEPS.length, total: STEPS.length, next: null });
  });

  it('the lead is the first step still to do; skipped steps stay open but never lead', () => {
    const l = setupLayout({ salon: 'done', location: 'skipped', shifts: 'todo' });
    expect(l.next).toBe('shifts');
    expect(l.done).toEqual(['salon']);
    expect(l.open).toContain('location');
    expect(l.open).not.toContain('shifts');
  });

  it('a finished setup has no lead and lists only the skipped steps as open', () => {
    const all = Object.fromEntries(STEPS.map((s) => [s, 'done'])) as Record<string, 'done'>;
    const l = setupLayout({ ...all, selfie: 'skipped' });
    expect(l.next).toBeNull();
    expect(l.open).toEqual(['selfie']);
    expect(l.done).toHaveLength(STEPS.length - 1);
  });
});
