import type { HTMLAttributes, ReactNode } from 'react';
import { Icon } from '../icons/Icon';
import { cx } from '../lib/cx';
import type { StatTone } from './StatChip';
import { STATUS_ICON } from './StatusChip';

export interface ProgressSegment {
  key: string;
  value: number;
  tone: StatTone;
  /** The legend word with its number ("5 on time"). Also read out in the bar's label. */
  label: string;
}

export interface ProgressStripProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** The headline in words ("8 of 11 in"). */
  label: ReactNode;
  /** A short note on the right ("3 late"), optional. */
  aside?: ReactNode;
  segments: readonly ProgressSegment[];
  /** The whole (11 staff today). What the segments do not fill shows as the blush track. */
  total: number;
  /** Show the colour + icon + word legend under the bar (default true). */
  legend?: boolean | undefined;
  /** The bar's accessible description ("8 of 11 in: 5 on time, 3 late"). */
  description: string;
}

/**
 * One thin segmented bar under a headline in words: how much of today is done ("8 of 11 in").
 * Not a stat card and not a chart (PRD 12.11 #5): the words carry the numbers, the bar only helps
 * scanning, and the legend repeats each colour with its icon and word.
 */
export function ProgressStrip({
  label,
  aside,
  segments,
  total,
  legend = true,
  description,
  className,
  ...rest
}: ProgressStripProps) {
  const safeTotal = Math.max(total, 1);
  const shown = segments.filter((s) => s.value > 0);
  return (
    <div className={cx('fs-meter', className)} {...rest}>
      <div className="fs-meter__head">
        <span className="fs-meter__label">{label}</span>
        {aside ? <span className="fs-meter__aside">{aside}</span> : null}
      </div>
      <div className="fs-meter__bar" role="img" aria-label={description}>
        {shown.map((s) => (
          <span
            key={s.key}
            className="fs-meter__seg"
            data-tone={s.tone}
            style={{ width: `${(Math.min(s.value, safeTotal) / safeTotal) * 100}%` }}
          />
        ))}
      </div>
      {legend && shown.length > 0 ? (
        <ul className="fs-meter__legend" aria-hidden="true">
          {shown.map((s) => (
            <li key={s.key} data-tone={s.tone}>
              <Icon name={s.tone === 'neutral' ? 'users' : STATUS_ICON[s.tone]} />
              {s.label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
