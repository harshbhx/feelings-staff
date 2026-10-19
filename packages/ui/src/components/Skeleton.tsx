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
