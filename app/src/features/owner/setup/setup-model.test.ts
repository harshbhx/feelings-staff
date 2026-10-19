import { describe, expect, it } from 'vitest';
import { STEPS, setupProgress } from './setup-model';

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
});
