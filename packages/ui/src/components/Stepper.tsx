import { type ReactNode, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cx } from '../lib/cx';
import { IconButton } from './Button';

export interface StepperProps {
  /** What is counted ("Grace", "Fence radius"). */
  label: ReactNode;
  /** One quiet line under the label ("Late arrivals within this aren't counted."). */
  hint?: ReactNode;
  value?: number | undefined;
  defaultValue?: number | undefined;
  onValueChange?: ((value: number) => void) | undefined;
  min?: number | undefined;
  max?: number | undefined;
  step?: number | undefined;
  /** Unit after the number ("min", "m"). */
  unit?: string | undefined;
  disabled?: boolean | undefined;
  className?: string | undefined;
}

/**
 * A - / + counter for minutes and radius (PRD 12.6), from the website's Stepper.astro: two 44 px
 * outline circles and a live value. The buttons stay focusable at the limits (aria-disabled), so
 * focus never jumps away.
 */
export function Stepper({
  label,
  hint,
  value,
  defaultValue,
  onValueChange,
  min = 0,
  max = Number.POSITIVE_INFINITY,
  step = 1,
  unit,
  disabled = false,
  className,
}: StepperProps) {
  const { t } = useTranslation();
  const id = useId();
  const [inner, setInner] = useState(defaultValue ?? min);
  const current = value ?? inner;
  const set = (next: number) => {
    const clamped = Math.min(max, Math.max(min, next));
    if (clamped === current) return;
    if (value === undefined) setInner(clamped);
    onValueChange?.(clamped);
  };
  const atMin = disabled || current <= min;
  const atMax = disabled || current >= max;
  return (
    <fieldset
      className={cx('fs-stepper', className)}
      aria-labelledby={`${id}-label`}
      aria-describedby={hint ? `${id}-hint` : undefined}
      data-disabled={disabled ? '' : undefined}
    >
      <span className="fs-stepper__text">
        <span className="fs-stepper__label" id={`${id}-label`}>
          {label}
        </span>
        {hint ? (
          <span className="fs-stepper__hint" id={`${id}-hint`}>
            {hint}
          </span>
        ) : null}
      </span>
      <span className="fs-stepper__controls">
        <IconButton
          icon="minus"
          variant="outline"
          label={t('ui:stepper.decrease')}
          aria-disabled={atMin || undefined}
          onClick={() => !atMin && set(current - step)}
        />
        <output className="fs-stepper__value" aria-live="polite">
          {current}
          {unit ? <span className="fs-stepper__unit"> {unit}</span> : null}
        </output>
        <IconButton
          icon="plus"
          variant="outline"
          label={t('ui:stepper.increase')}
          aria-disabled={atMax || undefined}
          onClick={() => !atMax && set(current + step)}
        />
      </span>
    </fieldset>
  );
}
