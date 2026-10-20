import { type ChangeEvent, type ReactNode, useId, useState } from 'react';
import { Icon, type IconName } from '../icons/Icon';
import { cx } from '../lib/cx';
import { type DayStatus, STATUS_ICON } from './StatusChip';

/** A day status, or `neutral` for "Everyone" and other counts that are not a status. */
export type StatTone = DayStatus | 'neutral';

export interface StatOption {
  value: string;
  /** The word after the number ("in", "late", "not in yet"). */
  label: ReactNode;
  count: number | string;
  /** Tints the icon disc and the chosen face. Default `neutral`. */
  tone?: StatTone | undefined;
  /** Defaults to the status icon (PRD 12.3); `users` for neutral. */
  icon?: IconName | undefined;
  disabled?: boolean | undefined;
}

export interface StatChipGroupProps {
  /** What the chips filter ("Show"). Names the fieldset. */
  legend: ReactNode;
  legendHidden?: boolean | undefined;
  options: readonly StatOption[];
  value?: string | undefined;
  defaultValue?: string | undefined;
  onValueChange?: ((value: string) => void) | undefined;
  name?: string | undefined;
  /** `scroll` (default) keeps one swipeable row on phones and wraps from 64rem; `wrap` always wraps. */
  layout?: 'scroll' | 'wrap' | undefined;
  className?: string | undefined;
}

function iconFor(o: StatOption): IconName {
  if (o.icon) return o.icon;
  return !o.tone || o.tone === 'neutral' ? 'users' : STATUS_ICON[o.tone];
}

/**
 * Tappable counts that filter a list ("8 in · 3 late · 1 not in yet"), from the shadcn/Cal.com stat
 * pattern on our Radix-free chips: real radios, so arrows move and Space chooses. Each chip is the
 * number, a word and the status icon on its tint; the chosen one takes the status tint.
 */
export function StatChipGroup({
  legend,
  legendHidden = false,
  options,
  value,
  defaultValue,
  onValueChange,
  name,
  layout = 'scroll',
  className,
}: StatChipGroupProps) {
  const id = useId();
  const groupName = name ?? `stats${id}`;
  const [inner, setInner] = useState(defaultValue);
  const selected = value ?? inner;
  return (
    <fieldset className={cx('fs-field', 'fs-stat-group', className)}>
      <legend className={cx('fs-field__label', legendHidden && 'sr-only')}>{legend}</legend>
      <div className="fs-stat-group__items" data-layout={layout}>
        {options.map((o) => {
          const labelId = `${id}-${o.value}`;
          return (
            <label
              key={o.value}
              className="fs-stat"
              data-tone={o.tone ?? 'neutral'}
              data-disabled={o.disabled ? '' : undefined}
              data-press=""
            >
              <input
                className="fs-stat__input"
                type="radio"
                name={groupName}
                value={o.value}
                checked={selected === o.value}
                disabled={o.disabled}
                aria-labelledby={labelId}
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  if (!e.target.checked) return;
                  if (value === undefined) setInner(o.value);
                  onValueChange?.(o.value);
                }}
              />
              <span className="fs-stat__face">
                <span className="fs-stat__disc" aria-hidden="true">
                  <Icon name={iconFor(o)} />
                </span>
                <span className="fs-stat__text" id={labelId}>
                  <span className="fs-stat__count">{o.count}</span>{' '}
                  <span className="fs-stat__label">{o.label}</span>
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
