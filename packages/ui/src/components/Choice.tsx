import { Checkbox as RCheckbox, RadioGroup as RRadioGroup, Switch as RSwitch } from 'radix-ui';
import { type ReactNode, useId } from 'react';
import { Icon } from '../icons/Icon';
import { cx } from '../lib/cx';
import { FieldError } from './Field';

/*
 * Checkbox, RadioGroup and Switch (PRD 12.6), Radix primitives restyled. "On" is ink, not
 * sindoor: lists of ticks would otherwise turn a screen red (PRD 12.2, 3-5 red placements).
 * Every row is a 44 px target with the label clickable.
 */

export interface CheckboxProps {
  label: ReactNode;
  description?: ReactNode;
  checked?: boolean | 'indeterminate' | undefined;
  defaultChecked?: boolean | undefined;
  onCheckedChange?: ((checked: boolean) => void) | undefined;
  disabled?: boolean | undefined;
  required?: boolean | undefined;
  name?: string | undefined;
  value?: string | undefined;
  id?: string | undefined;
  className?: string | undefined;
}

export function Checkbox({
  label,
  description,
  checked,
  defaultChecked,
  onCheckedChange,
  disabled,
  required,
  name,
  value,
  id,
  className,
}: CheckboxProps) {
  const autoId = useId();
  const boxId = id ?? `cb${autoId}`;
  return (
    <div className={cx('fs-choice', className)} data-disabled={disabled ? '' : undefined}>
      <RCheckbox.Root
        id={boxId}
        className="fs-checkbox"
        checked={checked}
        defaultChecked={defaultChecked}
        onCheckedChange={(c) => onCheckedChange?.(c === true)}
        disabled={disabled}
        required={required}
        name={name}
        value={value}
        aria-describedby={description ? `${boxId}-desc` : undefined}
      >
        <RCheckbox.Indicator className="fs-checkbox__mark">
          <Icon name={checked === 'indeterminate' ? 'minus' : 'check'} />
        </RCheckbox.Indicator>
      </RCheckbox.Root>
      <span className="fs-choice__text">
        <label htmlFor={boxId} className="fs-choice__label">
          {label}
        </label>
        {description ? (
          <span id={`${boxId}-desc`} className="fs-choice__desc">
            {description}
          </span>
        ) : null}
      </span>
    </div>
  );
}

export interface RadioOption {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean | undefined;
}

export interface RadioGroupProps {
  legend: ReactNode;
  legendHidden?: boolean | undefined;
  options: readonly RadioOption[];
  value?: string | undefined;
  defaultValue?: string | undefined;
  onValueChange?: ((value: string) => void) | undefined;
  error?: ReactNode;
  disabled?: boolean | undefined;
  required?: boolean | undefined;
  name?: string | undefined;
  className?: string | undefined;
}

/** A vertical list of radios with a visible legend; arrow keys move the choice (Radix). */
export function RadioGroup({
  legend,
  legendHidden = false,
  options,
  value,
  defaultValue,
  onValueChange,
  error,
  disabled,
  required,
  name,
  className,
}: RadioGroupProps) {
  const id = useId();
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className={cx('fs-field', className)} data-invalid={error ? '' : undefined}>
      <span id={`${id}-legend`} className={cx('fs-field__label', legendHidden && 'sr-only')}>
        {legend}
      </span>
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
      <RRadioGroup.Root
        className="fs-radio-group"
        aria-labelledby={`${id}-legend`}
        aria-describedby={errorId}
        value={value}
        defaultValue={defaultValue}
        onValueChange={onValueChange}
        disabled={disabled}
        required={required}
        name={name}
      >
        {options.map((o) => {
          const itemId = `${id}-${o.value}`;
          return (
            <div
              key={o.value}
              className="fs-choice"
              data-disabled={disabled || o.disabled ? '' : undefined}
            >
              <RRadioGroup.Item
                id={itemId}
                value={o.value}
                className="fs-radio"
                disabled={o.disabled}
                aria-describedby={o.description ? `${itemId}-desc` : undefined}
              >
                <RRadioGroup.Indicator className="fs-radio__dot" />
              </RRadioGroup.Item>
              <span className="fs-choice__text">
                <label htmlFor={itemId} className="fs-choice__label">
                  {o.label}
                </label>
                {o.description ? (
                  <span id={`${itemId}-desc`} className="fs-choice__desc">
                    {o.description}
                  </span>
                ) : null}
              </span>
            </div>
          );
        })}
      </RRadioGroup.Root>
    </div>
  );
}

export interface SwitchProps {
  label: ReactNode;
  /** One line on what this does ("Grace: 10 min. Late arrivals within 10 min aren't counted."). */
  description?: ReactNode;
  checked?: boolean | undefined;
  defaultChecked?: boolean | undefined;
  onCheckedChange?: ((checked: boolean) => void) | undefined;
  disabled?: boolean | undefined;
  name?: string | undefined;
  id?: string | undefined;
  className?: string | undefined;
}

/** A settings row: label and description on the left, the switch on the right. */
export function Switch({
  label,
  description,
  checked,
  defaultChecked,
  onCheckedChange,
  disabled,
  name,
  id,
  className,
}: SwitchProps) {
  const autoId = useId();
  const switchId = id ?? `sw${autoId}`;
  return (
    <div className={cx('fs-switch-row', className)} data-disabled={disabled ? '' : undefined}>
      <span className="fs-choice__text">
        <label htmlFor={switchId} className="fs-choice__label">
          {label}
        </label>
        {description ? (
          <span id={`${switchId}-desc`} className="fs-choice__desc">
            {description}
          </span>
        ) : null}
      </span>
      <RSwitch.Root
        id={switchId}
        className="fs-switch"
        checked={checked}
        defaultChecked={defaultChecked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        name={name}
        aria-describedby={description ? `${switchId}-desc` : undefined}
      >
        <RSwitch.Thumb className="fs-switch__thumb" />
      </RSwitch.Root>
    </div>
  );
}
