import type { HTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from '../icons/Icon';
import { cx } from '../lib/cx';

export type BadgeTone = 'success' | 'warning' | 'info' | 'neutral' | 'outline';

export interface BadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /**
   * `success` (green: inside the salon area, synced), `warning` (henna: at the edge, running late),
   * `info` (plum: elsewhere, at a venue), `neutral` (ink: offline, added by you), `outline` (a
   * quiet word next to a tinted one). Red is never a badge tone: it stays for the brand and errors.
   */
  tone: BadgeTone;
  /** Required: status is colour + icon + word, never colour alone (PRD 12.3, 12.11). */
  icon: IconName;
  children: ReactNode;
}

/**
 * A word that is not a day status ("Inside", "Edge", "Phone"), drawn like a `StatusChip`: tint,
 * icon and word, square-ish corners so it never reads as a button.
 */
export function Badge({ tone, icon, children, className, ...rest }: BadgeProps) {
  return (
    <span className={cx('fs-status', className)} data-tone={tone} {...rest}>
      <Icon name={icon} className="fs-status__icon" />
      <span>{children}</span>
    </span>
  );
}
