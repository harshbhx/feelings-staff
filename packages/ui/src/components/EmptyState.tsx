import type { HTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from '../icons/Icon';
import { cx } from '../lib/cx';

export interface EmptyStateProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'title'> {
  /** One sentence, in the salon's voice ("All clear. Nothing waiting."). */
  children: ReactNode;
  /** A short heading above the sentence, when the sentence alone is not enough. */
  title?: ReactNode;
  /** A glyph in a tinted disc above the text (the iOS "content unavailable" look). */
  icon?: IconName;
  /** At most one action, usually a secondary `Button`. */
  action?: ReactNode;
}

/** An empty list: a glyph, one sentence and, where it helps, one action (PRD 5, 12.11). */
export function EmptyState({ children, title, icon, action, className, ...rest }: EmptyStateProps) {
  return (
    <div className={cx('fs-empty', className)} {...rest}>
      {icon ? (
        <span className="fs-empty__icon" aria-hidden="true">
          <Icon name={icon} />
        </span>
      ) : null}
      {title ? <p className="fs-empty__title">{title}</p> : null}
      <p className="fs-empty__text">{children}</p>
      {action ? <div className="fs-empty__action">{action}</div> : null}
    </div>
  );
}
