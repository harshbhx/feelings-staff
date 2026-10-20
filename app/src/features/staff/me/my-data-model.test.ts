import { describe, expect, it } from 'vitest';
import { latestConsents, nextSelfieDeletion } from './my-data-model';

const c = (kind: 'selfie' | 'privacy_notice', acceptedAt: number, withdrawnAt: number | null) => ({
  kind,
  version: 'v',
  lang: 'en',
  acceptedAt,
  withdrawnAt,
});

describe('my data rules', () => {
  it('keeps the newest consent per kind', () => {
    const out = latestConsents([
      c('selfie', 1, null),
      c('selfie', 2, 5),
      c('privacy_notice', 1, null),
    ]);
    expect(out).toHaveLength(2);
    expect(out.find((x) => x.kind === 'selfie')?.withdrawnAt).toBe(5);
  });

  it('finds the earliest selfie deletion date', () => {
    const s = (deletesOn: string) => ({ punchId: 'p', takenAt: 0, deletesOn, url: '/x' });
    expect(nextSelfieDeletion([])).toBeNull();
    expect(nextSelfieDeletion([s('2026-11-02'), s('2026-10-28')])).toBe('2026-10-28');
  });
});
