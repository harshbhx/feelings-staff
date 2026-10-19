import type { HTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from '../icons/Icon';
import { cx } from '../lib/cx';

export interface BannerProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  icon: IconName;
  children: ReactNode;
  /** One small action at the end ("Install", "Update"): a `Button size="sm"` or a link. */
  action?: ReactNode;
  /** `soft` (default) sits on blush; `plain` is white with hairlines only. */
  tone?: 'soft' | 'plain' | undefined;
  /** Announce changes politely (offline, queued punches). */
  live?: boolean | undefined;
}

/**
 * A slim full-width strip under the header: offline, queued punches, install, update
 * (PRD 5 shared states, 12.6). Hairlines, an icon, one line of text, at most one action.
 */
export function Banner({
  icon,
  children,
  action,
  tone = 'soft',
  live = false,
  className,
  ...rest
}: BannerProps) {
  return (
    <div
      className={cx('fs-banner', className)}
      data-tone={tone}
      role={live ? 'status' : undefined}
      {...rest}
    >
      <Icon name={icon} className="fs-banner__icon" />
      <p className="fs-banner__text">{children}</p>
      {action ? <div className="fs-banner__action">{action}</div> : null}
    </div>
  );
}
