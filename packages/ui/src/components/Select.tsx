import { Select as RSelect } from 'radix-ui';
import type { ReactNode } from 'react';
import { Icon } from '../icons/Icon';
import { cx } from '../lib/cx';
import { useFieldContext } from './Field';

export interface SelectOption {
  value: string;
  label: ReactNode;
  disabled?: boolean | undefined;
}

export interface SelectProps {
  options: readonly SelectOption[];
  value?: string | undefined;
  defaultValue?: string | undefined;
  onValueChange?: ((value: string) => void) | undefined;
  /** Shown before a choice is made ("Choose a month"). */
  placeholder?: ReactNode;
  disabled?: boolean | undefined;
  required?: boolean | undefined;
  name?: string | undefined;
  /** Needed only outside a `Field` (which gives the trigger its label). */
  'aria-label'?: string | undefined;
  className?: string | undefined;
}

/**
 * One choice from a short list (Radix Select), drawn like an input: 3.25 rem, hint and error from
 * the surrounding `Field`. Items are 44 px rows with a check on the chosen one.
 */
export function Select({
  options,
  value,
  defaultValue,
  onValueChange,
  placeholder,
  disabled,
  required,
  name,
  'aria-label': ariaLabel,
  className,
}: SelectProps) {
  const field = useFieldContext();
  return (
    <RSelect.Root
      value={value}
      defaultValue={defaultValue}
      onValueChange={onValueChange}
      disabled={disabled ?? field?.disabled}
      required={required ?? field?.required}
      name={name}
    >
      <RSelect.Trigger
        id={field?.id}
        className={cx('fs-input', 'fs-select', className)}
        aria-label={ariaLabel}
        aria-describedby={field?.describedBy}
        aria-invalid={field?.invalid || undefined}
      >
        <RSelect.Value placeholder={placeholder} />
        <RSelect.Icon className="fs-select__caret">
          <Icon name="caret-down" />
        </RSelect.Icon>
      </RSelect.Trigger>
      <RSelect.Portal>
        <RSelect.Content className="fs-popover fs-select__content" position="popper" sideOffset={6}>
          <RSelect.Viewport className="fs-select__viewport">
            {options.map((o) => (
              <RSelect.Item
                key={o.value}
                value={o.value}
                disabled={o.disabled}
                className="fs-select__item"
              >
                <RSelect.ItemText>{o.label}</RSelect.ItemText>
                <RSelect.ItemIndicator className="fs-select__check">
                  <Icon name="check" />
                </RSelect.ItemIndicator>
              </RSelect.Item>
            ))}
          </RSelect.Viewport>
        </RSelect.Content>
      </RSelect.Portal>
    </RSelect.Root>
  );
}
