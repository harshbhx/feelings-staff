/**
 * PIN pad (PRD 11.11, 12.6): a 3x4 grid of 64 px keys, dots that fill with sindoor, and a real
 * `input type=password inputmode=numeric autocomplete=one-time-code` laid over the dots, so screen
 * readers, keyboards and password managers use the input while thumbs use the keys. The keys are
 * a pointer convenience only (hidden from assistive tech, out of the tab order).
 * Swapped for `@fs/ui`'s PinPad when the kit lands.
 */
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { digitsOnly } from '../lib/inputs';
import { Icon } from './icons';

export interface PinLength {
  min: number;
  max: number;
}

export interface PinPadProps {
  label: string;
  hint?: string | undefined;
  value: string;
  onChange: (pin: string) => void;
  length: PinLength;
  error?: string | null | undefined;
  /** Fixed-length PINs (owner PIN, step-up) call this as soon as the last digit lands. */
  onComplete?: ((pin: string) => void) | undefined;
  disabled?: boolean | undefined;
  autoComplete?: 'one-time-code' | 'current-password' | 'new-password' | 'off';
  name?: string;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'delete'] as const;

/** Next value after a key press (pure; unit-tested). */
export function pressKey(value: string, key: string, max: number): string {
  if (key === 'delete') return value.slice(0, -1);
  if (!/^\d$/.test(key)) return value;
  return digitsOnly(value + key, max);
}

export function PinPad({
  label,
  hint,
  value,
  onChange,
  length,
  error,
  onComplete,
  disabled = false,
  autoComplete = 'one-time-code',
  name,
}: PinPadProps) {
  const { t } = useTranslation();
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');
  const fixed = length.min === length.max;

  const set = (raw: string) => {
    const next = digitsOnly(raw, length.max);
    if (next === value) return;
    onChange(next);
    if (fixed && next.length === length.max) onComplete?.(next);
  };

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-text">
        {label}
      </label>
      {hint ? (
        <p id={hintId} className="mt-1 text-sm text-text-muted">
          {hint}
        </p>
      ) : null}
      <div className="relative mt-3 flex h-14 items-center justify-center gap-4 rounded-md border border-border bg-bg-soft has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent has-[[aria-invalid=true]]:border-accent">
        <span aria-hidden="true" className="flex items-center gap-4">
          {Array.from({ length: length.max }, (_, i) => {
            const filled = i < value.length;
            const optional = i >= length.min;
            const look = filled
              ? 'bg-accent'
              : optional
                ? 'border border-dashed border-border-control'
                : 'border-2 border-border-control';
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed slots, never reordered
              <span key={i} className={`size-3.5 rounded-full ${look}`} />
            );
          })}
        </span>
        <input
          id={id}
          name={name}
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={autoComplete}
          maxLength={length.max}
          value={value}
          disabled={disabled}
          onChange={(e) => set(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          className="absolute inset-0 h-full w-full cursor-pointer rounded-md opacity-0"
        />
      </div>
      {error ? (
        <p
          id={errorId}
          className="mt-2 flex items-start gap-2 text-sm font-semibold text-[var(--status-absent)]"
        >
          <Icon name="warning-circle" className="mt-px" />
          <span>{error}</span>
        </p>
      ) : null}
      <div aria-hidden="true" className="mx-auto mt-5 grid max-w-[18rem] grid-cols-3 gap-3">
        {KEYS.map((key, i) =>
          key === '' ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: the one empty slot of a fixed grid
            <span key={`gap-${i}`} />
          ) : (
            <button
              key={key}
              type="button"
              tabIndex={-1}
              disabled={disabled}
              data-key={key}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => set(pressKey(value, key, length.max))}
              className="flex h-16 touch-manipulation items-center justify-center rounded-md border border-border bg-bg text-xl font-extrabold text-text tabular-nums transition-[transform,background-color] duration-100 select-none hover:bg-bg-soft active:scale-[0.97] active:bg-bg-tint disabled:opacity-60 motion-reduce:transition-none motion-reduce:active:scale-100"
            >
              {key === 'delete' ? (
                <Icon name="backspace" className="size-6" label={t('auth:pin.delete')} />
              ) : (
                key
              )}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
