import type { HTMLAttributes } from 'react';
import { cx } from '../lib/cx';

/** A span on the same scale as `start` and `end` (epoch ms, or minutes since midnight). */
export interface ShiftSpan {
  from: number;
  to: number;
}

export interface ShiftTimelineProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Shift start and end, on any one scale (epoch ms from the API, or minutes since midnight). */
  start: number;
  end: number;
  /** "10:00" and "20:00", shown under the ends. */
  startLabel: string;
  endLabel: string;
  /** Now, on the same scale. Outside the shift the marker sits at the nearer end. */
  now: number;
  /** Time worked so far (check-in to check-out, or to now while in). Drawn in the present green. */
  worked?: readonly ShiftSpan[] | undefined;
  /** The whole picture in words for screen readers ("Shift 10:00 to 20:00, now 10:42, in since 10:02"). */
  description: string;
}

const pct = (v: number, start: number, end: number) =>
  `${(Math.min(Math.max(v - start, 0), end - start) / Math.max(end - start, 1)) * 100}%`;

/**
 * The shift as one thin line from start to end, the worked part filled, a now marker (WP-10,
 * staff Today). Static: it moves when the minute changes, never animates in a loop (PRD 12.8).
 */
export function ShiftTimeline({
  start,
  end,
  startLabel,
  endLabel,
  now,
  worked = [],
  description,
  className,
  ...rest
}: ShiftTimelineProps) {
  return (
    <div className={cx('fs-shift', className)} {...rest}>
      <div className="fs-shift__track" role="img" aria-label={description}>
        {worked.map((w) => (
          <span
            key={`${w.from}-${w.to}`}
            className="fs-shift__worked"
            style={{
              left: pct(w.from, start, end),
              width: `calc(${pct(w.to, start, end)} - ${pct(w.from, start, end)})`,
            }}
          />
        ))}
        <span className="fs-shift__now" style={{ left: pct(now, start, end) }} />
      </div>
      <div className="fs-shift__ends" aria-hidden="true">
        <span>{startLabel}</span>
        <span>{endLabel}</span>
      </div>
    </div>
  );
}
