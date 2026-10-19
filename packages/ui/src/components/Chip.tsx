import { type ChangeEvent, type ReactNode, useId, useState } from 'react';
import { Icon, type IconName } from '../icons/Icon';
import { cx } from '../lib/cx';
import { FieldError } from './Field';

export interface ChipProps {
  type: 'radio' | 'checkbox';
  value: string;
  label: ReactNode;
  /** A second line: the chip becomes a card (leave type with its balance). */
  description?: ReactNode;
  /** A number after the label (a filter chip's count). */
  count?: number | string | undefined;
  /** An icon in place of the neutral dot. It turns into the check when chosen. */
  icon?: IconName | undefined;
  name?: string | undefined;
  checked?: boolean | undefined;
  defaultChecked?: boolean | undefined;
  onCheckedChange?: ((checked: boolean) => void) | undefined;
  disabled?: boolean | undefined;
  required?: boolean | undefined;
  invalid?: boolean | undefined;
  className?: string | undefined;
}

/**
 * A real radio or checkbox drawn as a pill (or a card with a description), from the website's
 * Chip.astro. The keyboard and screen readers get the native control: Tab, arrows, Space.
 */
export function Chip({
  type,
  value,
  label,
  description,
  count,
  icon,
  name,
  checked,
  defaultChecked,
  onCheckedChange,
  disabled,
  required,
  invalid,
  className,
}: ChipProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const descId = description ? `${id}-desc` : undefined;
  const countId = count !== undefined ? `${id}-count` : undefined;
  return (
    <label
      className={cx('fs-chip', className)}
      data-has-desc={description ? '' : undefined}
      data-disabled={disabled ? '' : undefined}
      data-invalid={invalid ? '' : undefined}
      data-press=""
    >
      <input
        className="fs-chip__input"
        type={type}
        name={name}
        value={value}
        checked={checked}
        defaultChecked={defaultChecked}
        disabled={disabled}
        required={required}
        aria-labelledby={countId ? `${labelId} ${countId}` : labelId}
        aria-describedby={descId}
        aria-invalid={invalid || undefined}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onCheckedChange?.(e.target.checked)}
      />
      <span className="fs-chip__face">
        <span className="fs-chip__mark" aria-hidden="true">
          {icon ? (
            <Icon name={icon} className="fs-chip__icon" />
          ) : (
            <span className="fs-chip__dot" />
          )}
          <Icon name="check-circle" className="fs-chip__check" />
        </span>
        <span className="fs-chip__text">
          <span className="fs-chip__label" id={labelId}>
            {label}
          </span>
          {description ? (
            <span className="fs-chip__desc" id={descId}>
              {description}
            </span>
          ) : null}
        </span>
        {count !== undefined ? (
          <span className="fs-chip__count" id={countId}>
            {count}
          </span>
        ) : null}
      </span>
    </label>
  );
}

export interface ChipOption {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  count?: number | string | undefined;
  icon?: IconName | undefined;
  disabled?: boolean | undefined;
}

interface ChipGroupBase {
  /** What the group chooses ("Leave type"). Required: it names the fieldset. */
  legend: ReactNode;
  legendHidden?: boolean | undefined;
  hint?: ReactNode;
  error?: ReactNode;
  options: readonly ChipOption[];
  name?: string | undefined;
  disabled?: boolean | undefined;
  required?: boolean | undefined;
  /** `wrap` (default) flows pills onto lines; `grid` sets cards in two columns; `scroll` keeps one swipeable row. */
  layout?: 'wrap' | 'grid' | 'scroll' | undefined;
  className?: string | undefined;
}

export interface ChipRadioGroupProps extends ChipGroupBase {
  type?: 'radio' | undefined;
  value?: string | undefined;
  defaultValue?: string | undefined;
  onValueChange?: ((value: string) => void) | undefined;
}

export interface ChipCheckboxGroupProps extends ChipGroupBase {
  type: 'checkbox';
  value?: readonly string[] | undefined;
  defaultValue?: readonly string[] | undefined;
  onValueChange?: ((value: string[]) => void) | undefined;
}

export type ChipGroupProps = ChipRadioGroupProps | ChipCheckboxGroupProps;

/** A fieldset of chips: one choice (radios) or several (checkboxes). */
export function ChipGroup(props: ChipGroupProps) {
  const {
    legend,
    legendHidden = false,
    hint,
    error,
    options,
    name,
    disabled = false,
    required = false,
    layout = 'wrap',
    className,
  } = props;
  const id = useId();
  const groupName = name ?? `chips${id}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  const isCheckbox = props.type === 'checkbox';
  const [inner, setInner] = useState<readonly string[]>(() => {
    if (props.type === 'checkbox') return props.defaultValue ?? [];
    return props.defaultValue !== undefined ? [props.defaultValue] : [];
  });
  const controlled = props.value !== undefined;
  const selected: readonly string[] = controlled
    ? props.type === 'checkbox'
      ? (props.value ?? [])
      : props.value !== undefined
        ? [props.value]
        : []
    : inner;

  const change = (value: string, checked: boolean) => {
    if (props.type === 'checkbox') {
      const next = checked
        ? [...selected.filter((v) => v !== value), value]
        : selected.filter((v) => v !== value);
      if (!controlled) setInner(next);
      props.onValueChange?.(next);
    } else if (checked) {
      if (!controlled) setInner([value]);
      props.onValueChange?.(value);
    }
  };

  return (
    <fieldset
      className={cx('fs-field', 'fs-chip-group', className)}
      aria-describedby={describedBy}
      disabled={disabled}
      data-invalid={error ? '' : undefined}
    >
      <legend className={cx('fs-field__label', legendHidden && 'sr-only')}>{legend}</legend>
      {hint ? (
        <p id={hintId} className="fs-field__hint">
          {hint}
        </p>
      ) : null}
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
      <div className="fs-chip-group__items" data-layout={layout}>
        {options.map((o) => (
          <Chip
            key={o.value}
            type={isCheckbox ? 'checkbox' : 'radio'}
            name={groupName}
            value={o.value}
            label={o.label}
            description={o.description}
            count={o.count}
            icon={o.icon}
            disabled={o.disabled}
            required={!isCheckbox && required}
            invalid={Boolean(error)}
            checked={selected.includes(o.value)}
            onCheckedChange={(c) => change(o.value, c)}
          />
        ))}
      </div>
    </fieldset>
  );
}
