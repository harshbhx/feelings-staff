import type { HTMLAttributes, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, type IconName } from '../icons/Icon';
import { cx } from '../lib/cx';

export type DayStatus =
  | 'present'
  | 'late'
  | 'half'
  | 'absent'
  | 'leave'
  | 'off'
  | 'holiday'
  | 'flag'
  | 'waiting'
  | 'venue';

/** PRD 12.3: icon per status. Colours live in app-tokens.css (`--status-*`). */
export const STATUS_ICON: Record<DayStatus, IconName> = {
  present: 'check-circle',
  late: 'clock',
  half: 'circle-half',
  absent: 'x-circle',
  leave: 'airplane-tilt',
  off: 'minus',
  holiday: 'confetti',
  flag: 'warning-circle',
  waiting: 'hourglass',
  venue: 'map-pin',
};

/** Statuses with a register letter (P, H, A, L, WO, HO, OD). Late, flag and waiting are tags only. */
export const STATUS_HAS_LETTER: Record<DayStatus, boolean> = {
  present: true,
  late: false,
  half: true,
  absent: true,
  leave: true,
  off: true,
  holiday: true,
  flag: false,
  waiting: false,
  venue: true,
};

export interface StatusChipProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  status: DayStatus;
  /** The word. Defaults to the status name from the `ui` catalog ("Present"); pass "Late 18 m" to add detail. */
  label?: ReactNode;
  /**
   * `word` (default): icon + word. `letter`: icon + letter (P, H, A...) with the word kept for
   * screen readers, for calendars and the register.
   */
  variant?: 'word' | 'letter' | undefined;
}

/** A status mark: colour + icon + word, never colour alone, never clickable-looking (PRD 12.3). */
export function StatusChip({
  status,
  label,
  variant = 'word',
  className,
  ...rest
}: StatusChipProps) {
  const { t } = useTranslation();
  const word = label ?? t(`ui:status.${status}.word`);
  const showLetter = variant === 'letter' && STATUS_HAS_LETTER[status];
  return (
    <span className={cx('fs-status', className)} data-status={status} {...rest}>
      <Icon name={STATUS_ICON[status]} className="fs-status__icon" />
      {showLetter ? (
        <>
          <span aria-hidden="true">{t(`ui:status.${status}.letter`)}</span>
          <span className="sr-only">{word}</span>
        </>
      ) : (
        <span>{word}</span>
      )}
    </span>
  );
}
