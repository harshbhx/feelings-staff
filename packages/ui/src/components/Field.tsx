import {
  type ComponentProps,
  createContext,
  type ReactNode,
  useContext,
  useId,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../icons/Icon';
import { cx } from '../lib/cx';
import { IconButton } from './Button';

interface FieldContextValue {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
  required: boolean;
  disabled: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

/** The id, description and state of the surrounding `Field`, for custom controls. */
export function useFieldContext(): FieldContextValue | null {
  return useContext(FieldContext);
}

export interface FieldProps {
  label: ReactNode;
  /** Help text. It sits above the control so the phone keyboard never covers it. */
  hint?: ReactNode;
  /** Validation message, shown above the control in `--status-absent` with an icon. */
  error?: ReactNode;
  /** Adds a quiet "optional" after the label. */
  optional?: boolean | undefined;
  required?: boolean | undefined;
  disabled?: boolean | undefined;
  /** Keep the label for screen readers only (a search box with its own placeholder example). */
  labelHidden?: boolean | undefined;
  /** Id for the control; generated when absent. */
  id?: string | undefined;
  className?: string | undefined;
  children: ReactNode;
}

/**
 * Label, hint, error and one control (`Input`, `Textarea`, `PasswordInput`, `Select`...), wired
 * together with `aria-describedby` and `aria-invalid` (PRD 11.11, 12.6).
 */
export function Field({
  label,
  hint,
  error,
  optional = false,
  required = false,
  disabled = false,
  labelHidden = false,
  id,
  className,
  children,
}: FieldProps) {
  const { t } = useTranslation();
  const autoId = useId();
  const controlId = id ?? `f${autoId}`;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;
  const invalid = Boolean(error);
  return (
    <FieldContext.Provider value={{ id: controlId, describedBy, invalid, required, disabled }}>
      <div
        className={cx('fs-field', className)}
        data-invalid={invalid ? '' : undefined}
        data-disabled={disabled ? '' : undefined}
      >
        <label htmlFor={controlId} className={cx('fs-field__label', labelHidden && 'sr-only')}>
          {label}
          {optional ? <span className="fs-field__optional">{t('ui:field.optional')}</span> : null}
        </label>
        {hint ? (
          <p id={hintId} className="fs-field__hint">
            {hint}
          </p>
        ) : null}
        {error ? <FieldError id={errorId}>{error}</FieldError> : null}
        {children}
      </div>
    </FieldContext.Provider>
  );
}

/** The error line with its icon. Used by `Field`, and by groups (`ChipGroup`) directly. */
export function FieldError({ id, children }: { id?: string | undefined; children: ReactNode }) {
  return (
    <p id={id} className="fs-field__error" role="alert">
      <Icon name="warning-circle" />
      <span>{children}</span>
    </p>
  );
}

/** Merge a control's own props with the surrounding Field's id, description and state. */
function useControlProps<P extends ComponentProps<'input'> | ComponentProps<'textarea'>>(
  props: P,
): P {
  const field = useContext(FieldContext);
  if (!field) return props;
  const describedBy =
    [field.describedBy, props['aria-describedby']].filter(Boolean).join(' ') || undefined;
  return {
    ...props,
    id: props.id ?? field.id,
    'aria-describedby': describedBy,
    'aria-invalid': props['aria-invalid'] ?? (field.invalid || undefined),
    required: props.required ?? (field.required || undefined),
    disabled: props.disabled ?? (field.disabled || undefined),
  } as P;
}

export interface InputProps extends ComponentProps<'input'> {
  /** Fixed text or an icon before the value ("+91"). */
  start?: ReactNode;
  /** A control or text after the value (show password, "min"). */
  end?: ReactNode;
}

/** Text input: 16 px or more so iOS never zooms, 3.25 rem tall (PRD 11.3, 12.6). */
export function Input({ start, end, className, ...props }: InputProps) {
  const merged = useControlProps(props);
  if (start === undefined && end === undefined) {
    return <input className={cx('fs-input', className)} {...merged} />;
  }
  return (
    <div
      className={cx('fs-input-wrap', className)}
      data-invalid={merged['aria-invalid'] ? '' : undefined}
      data-disabled={merged.disabled ? '' : undefined}
    >
      {start !== undefined ? <span className="fs-input-wrap__start">{start}</span> : null}
      <input className="fs-input" {...merged} />
      {end !== undefined ? <span className="fs-input-wrap__end">{end}</span> : null}
    </div>
  );
}

export type TextareaProps = ComponentProps<'textarea'>;

export function Textarea({ className, ...props }: TextareaProps) {
  const merged = useControlProps(props);
  return <textarea className={cx('fs-input', 'fs-textarea', className)} {...merged} />;
}

export type PasswordInputProps = Omit<InputProps, 'type' | 'end'>;

/** Password with a show/hide toggle. */
export function PasswordInput(props: PasswordInputProps) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);
  return (
    <Input
      {...props}
      type={shown ? 'text' : 'password'}
      autoCapitalize="off"
      spellCheck={false}
      end={
        <IconButton
          icon={shown ? 'eye-slash' : 'eye'}
          label={shown ? t('ui:password.hide') : t('ui:password.show')}
          onClick={() => setShown((s) => !s)}
          disabled={props.disabled}
        />
      }
    />
  );
}
