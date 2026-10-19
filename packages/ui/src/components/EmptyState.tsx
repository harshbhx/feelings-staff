import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../lib/cx';

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** One sentence, in the salon's voice ("All clear. Nothing waiting."). */
  children: ReactNode;
  /** At most one action, usually a secondary `Button`. */
  action?: ReactNode;
}

/** An empty list: one sentence and, where it helps, one action. No illustrations (PRD 5, 12.11). */
export function EmptyState({ children, action, className, ...rest }: EmptyStateProps) {
  return (
    <div className={cx('fs-empty', className)} {...rest}>
      <p className="fs-empty__text">{children}</p>
      {action ? <div className="fs-empty__action">{action}</div> : null}
    </div>
  );
}
