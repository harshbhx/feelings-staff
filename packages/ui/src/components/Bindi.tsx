import type { HTMLAttributes } from 'react';
import { cx } from '../lib/cx';

export type BindiSize = 'heading' | 'marker' | 'success';

export interface BindiProps extends HTMLAttributes<HTMLSpanElement> {
  /**
   * `heading`: the full stop on a heading (0.17em). `marker`: the 6 px active-nav dot.
   * `success`: the 24 px dot on the check-in success screen.
   */
  size?: BindiSize | undefined;
  /** Land once with the brand spring (520 ms). Only for the success moment (PRD 12.8). */
  land?: boolean | undefined;
}

/**
 * The bindi: the brand's one signature mark (PRD 12.9). Decorative, so hidden from screen
 * readers. Use it only in the places 12.9 lists.
 */
export function Bindi({ size = 'heading', land = false, className, ...rest }: BindiProps) {
  return (
    <span
      aria-hidden="true"
      className={cx('fs-bindi', className)}
      data-size={size}
      data-land={land ? '' : undefined}
      {...rest}
    />
  );
}
