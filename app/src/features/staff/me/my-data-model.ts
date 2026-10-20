/** Small rules for My data and Privacy (PRD 10.6; AC S-16). */
import type { ConsentKind, ConsentView, MyData } from '@fs/contracts';

/** The newest row per consent kind (a new version supersedes the earlier one; a withdrawal is recorded on the same row). */
export function latestConsents(rows: readonly ConsentView[]): ConsentView[] {
  const byKind = new Map<ConsentKind, ConsentView>();
  for (const c of rows) {
    const seen = byKind.get(c.kind);
    if (!seen || c.acceptedAt > seen.acceptedAt) byKind.set(c.kind, c);
  }
  return [...byKind.values()];
}

/** The date the next kept selfie is deleted ("The next one goes on 28 Oct"), or null. */
export function nextSelfieDeletion(selfies: MyData['selfies']): string | null {
  let next: string | null = null;
  for (const s of selfies) if (next === null || s.deletesOn < next) next = s.deletesOn;
  return next;
}
