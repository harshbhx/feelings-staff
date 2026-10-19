/**
 * The bottom action bar (PRD 12.5): glass, safe-area padded, above the tab bar. It holds the
 * view's one sindoor button (and at most one secondary next to it).
 */
import type { ReactNode } from 'react';

export function ActionBar({ children }: { children: ReactNode }) {
  return (
    <div className="staff-actionbar">
      <div className="staff-actionbar__inner">{children}</div>
    </div>
  );
}
