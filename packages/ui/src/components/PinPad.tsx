import { type ChangeEvent, type ReactNode, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../icons/Icon';
import { cx } from '../lib/cx';
import { FieldError } from './Field';

export interface PinPadProps {
  /** Visible label ("Enter your PIN"). It names the real input. */
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  value?: string | undefined;
  defaultValue?: string | undefined;
  onValueChange?: ((value: string) => void) | undefined;
  /** Called once the PIN reaches `maxLength` (or `length`). */
  onComplete?: ((value: string) => void) | undefined;
  /** A fixed length (the owner's 6-digit PIN). Sets both `minLength` and `maxLength`. */
  length?: number | undefined;
  /** Staff PINs are 4 to 6 digits (PRD 4.1). Defaults 4 and 6. */
  minLength?: number | undefined;
  maxLength?: number | undefined;
  disabled?: boolean | undefined;
  /** Focus the real input on mount (desktop step-up). Leave off on phones: it opens the keyboard. */
  autoFocus?: boolean | undefined;
  id?: string | undefined;
  name?: string | undefined;
  className?: string | undefined;
}

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

/**
 * The PIN pad: a 3x4 grid of 64 px keys over a real `input type=password inputmode=numeric
 * autocomplete=one-time-code`, so screen readers, hardware keyboards and password managers
 * behave (PRD 11.11, 12.6). Dots fill with sindoor.
 */
export function PinPad({
  label,
  hint,
  error,
  value,
  defaultValue,
  onValueChange,
  onComplete,
  length,
  minLength = 4,
  maxLength = 6,
  disabled = false,
  autoFocus = false,
  id,
  name,
  className,
}: PinPadProps) {
  const { t } = useTranslation();
  const autoId = useId();
  const inputId = id ?? `pin${autoId}`;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const min = length ?? minLength;
  const max = length ?? maxLength;

  const [inner, setInner] = useState(defaultValue ?? '');
  const pin = value ?? inner;

  const commit = (next: string) => {
    if (next === pin) return;
    if (value === undefined) setInner(next);
    onValueChange?.(next);
    if (next.length === max && pin.length < max) onComplete?.(next);
  };

  const press = (digit: string) => {
    if (disabled || pin.length >= max) return;
    commit(pin + digit);
  };
  const erase = () => {
    if (disabled || pin.length === 0) return;
    commit(pin.slice(0, -1));
  };
  const typed = (e: ChangeEvent<HTMLInputElement>) => {
    commit(e.target.value.replace(/\D/g, '').slice(0, max));
  };

  const dots = Math.min(max, Math.max(min, pin.length));
  const keepFocus = (e: { preventDefault: () => void }) => e.preventDefault();

  return (
    <div
      className={cx('fs-pinpad', className)}
      data-invalid={error ? '' : undefined}
      data-disabled={disabled ? '' : undefined}
    >
      <label htmlFor={inputId} className="fs-pinpad__label">
        {label}
      </label>
      {hint ? (
        <p id={hintId} className="fs-field__hint fs-pinpad__hint">
          {hint}
        </p>
      ) : null}
      <div className="fs-pinpad__display">
        <input
          id={inputId}
          name={name}
          className="fs-pinpad__input"
          type="password"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          minLength={min}
          maxLength={max}
          value={pin}
          onChange={typed}
          disabled={disabled}
          // biome-ignore lint/a11y/noAutofocus: opt-in for the desktop step-up sheet only
          autoFocus={autoFocus}
          aria-invalid={error ? true : undefined}
          aria-describedby={[errorId, hintId].filter(Boolean).join(' ') || undefined}
        />
        <div className="fs-pinpad__dots" aria-hidden="true">
          {Array.from({ length: dots }, (_, i) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: dots are positional by nature
              key={i}
              className="fs-pinpad__dot"
              data-filled={i < pin.length ? '' : undefined}
            />
          ))}
        </div>
      </div>
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
      <div className="fs-pinpad__keys">
        {DIGITS.map((d) => (
          <button
            key={d}
            type="button"
            tabIndex={-1}
            className="fs-pinpad__key"
            disabled={disabled}
            onMouseDown={keepFocus}
            onClick={() => press(d)}
          >
            {d}
          </button>
        ))}
        <span className="fs-pinpad__spacer" aria-hidden="true" />
        <button
          type="button"
          tabIndex={-1}
          className="fs-pinpad__key"
          disabled={disabled}
          onMouseDown={keepFocus}
          onClick={() => press('0')}
        >
          0
        </button>
        <button
          type="button"
          tabIndex={-1}
          className="fs-pinpad__key"
          data-kind="delete"
          disabled={disabled || pin.length === 0}
          aria-label={t('ui:pinPad.delete')}
          onMouseDown={keepFocus}
          onClick={erase}
        >
          <Icon name="backspace" />
        </button>
      </div>
      <p className="sr-only" aria-live="polite">
        {t('ui:pinPad.progress', { filled: pin.length, total: dots })}
      </p>
    </div>
  );
}
