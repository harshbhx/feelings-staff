import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cx } from '../lib/cx';

export interface SkeletonProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** CSS width ("60%", "8rem"). Default 100%. */
  width?: string | undefined;
  /** CSS height. Default one line of body text. */
  height?: string | undefined;
  /** `line` (default), `block` (a card or row), `pill` (a button or chip), `circle` (an avatar). */
  shape?: 'line' | 'block' | 'pill' | 'circle' | undefined;
}

/**
 * A blush block that keeps the final layout while data loads. It breathes at most 6 times, then
 * stays still; it never shimmers (PRD 5, 12.8).
 */
export function Skeleton({
  width,
  height,
  shape = 'line',
  className,
  style,
  ...rest
}: SkeletonProps) {
  const size: CSSProperties = { ...style };
  if (width) size.width = width;
  if (height) size.height = height;
  return (
    <span
      aria-hidden="true"
      className={cx('fs-skeleton', className)}
      data-shape={shape}
      style={size}
      {...rest}
    />
  );
}

export interface SkeletonGroupProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  children: ReactNode;
  /** What is loading, for screen readers. Defaults to "Loading". */
  label?: string | undefined;
}

/** Wraps skeletons so screen readers hear one "Loading" instead of empty shapes. */
export function SkeletonGroup({ children, label, className, ...rest }: SkeletonGroupProps) {
  const { t } = useTranslation();
  return (
    <div className={cx('fs-skeleton-group', className)} role="status" aria-busy="true" {...rest}>
      <span className="sr-only">{label ?? t('ui:loading')}</span>
      {children}
    </div>
  );
}

export interface SkeletonListProps {
  /** How many rows to hold (default 3). */
  rows?: number | undefined;
  /** Hold a chip at the end of each row too. */
  trailing?: boolean | undefined;
  /** What is loading, for screen readers. */
  label?: string | undefined;
  className?: string | undefined;
}

/** Placeholder `ListRow`s: avatar, two lines and an optional chip, in the final row height. */
export function SkeletonList({ rows = 3, trailing = false, label, className }: SkeletonListProps) {
  const widths = ['55%', '42%', '62%', '48%', '58%'];
  return (
    <SkeletonGroup label={label} className={cx('fs-skeleton-list', className)}>
      {Array.from({ length: rows }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholder rows
        <div key={i} className="fs-skeleton-list__row">
          <Skeleton shape="circle" />
          <div className="fs-skeleton-list__text">
            <Skeleton width={widths[i % widths.length]} />
            <Skeleton width="34%" height="0.8125rem" />
          </div>
          {trailing ? <Skeleton width="4.5rem" height="1.75rem" /> : null}
        </div>
      ))}
    </SkeletonGroup>
  );
}
