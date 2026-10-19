import { type ChangeEvent, type FocusEvent, useState } from 'react';
import { Icon } from '../icons/Icon';
import { Input, type InputProps } from './Field';

/*
 * PhoneField, CodeField and TimeField (PRD 12.6): an `Input` that formats as you type. Each
 * takes and returns the raw value (digits, code characters, "HH:MM"); the display adds the
 * spaces and hyphens. Use them inside a `Field` for the label, hint and error.
 */

type Base = Omit<InputProps, 'value' | 'defaultValue' | 'onChange' | 'type'>;

function useRaw(value: string | undefined, defaultValue: string | undefined) {
  const [inner, setInner] = useState(defaultValue ?? '');
  return [value ?? inner, (v: string) => value === undefined && setInner(v)] as const;
}

/** "9876543210" -> "98765 43210" (Indian mobile, 5 + 5). */
export function formatIndianMobile(digits: string): string {
  const d = digits.replace(/\D/g, '').slice(0, 10);
  return d.length > 5 ? `${d.slice(0, 5)} ${d.slice(5)}` : d;
}

export interface PhoneFieldProps extends Base {
  /** Ten digits, without +91. */
  value?: string | undefined;
  defaultValue?: string | undefined;
  onValueChange?: ((digits: string) => void) | undefined;
}

/** An Indian mobile number: "+91" fixed in front, typed as `98765 43210`. */
export function PhoneField({ value, defaultValue, onValueChange, ...rest }: PhoneFieldProps) {
  const [raw, setRaw] = useRaw(value, defaultValue);
  const change = (e: ChangeEvent<HTMLInputElement>) => {
    let d = e.target.value.replace(/\D/g, '');
    // A pasted "+91 98765 43210" or "09876543210" keeps the last ten digits.
    if (d.length > 10) d = d.slice(-10);
    setRaw(d);
    onValueChange?.(d);
  };
  return (
    <Input
      {...rest}
      type="tel"
      inputMode="numeric"
      autoComplete="tel-national"
      start="+91"
      value={formatIndianMobile(raw)}
      onChange={change}
      className="tabular-nums"
    />
  );
}

/** Crockford base32 (PRD 4.1): upper case, O -> 0, I and L -> 1, no U. */
export function normaliseJoinCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/[^0-9A-HJKMNP-TV-Z]/g, '')
    .slice(0, 8);
}

/** "K7Q4MZ2P" -> "K7Q-4MZ2P". */
export function formatJoinCode(code: string): string {
  const c = normaliseJoinCode(code);
  return c.length > 3 ? `${c.slice(0, 3)}-${c.slice(3)}` : c;
}

export interface CodeFieldProps extends Base {
  /** `join`: 8 characters shown as `XXX-XXXXX`. `otp6`: the owner's 6-digit email code. */
  variant?: 'join' | 'otp6' | undefined;
  /** The code without the hyphen. */
  value?: string | undefined;
  defaultValue?: string | undefined;
  onValueChange?: ((code: string) => void) | undefined;
  /** Called once the code is complete (8 characters, or 6 digits). */
  onComplete?: ((code: string) => void) | undefined;
}

/** A join code or a 6-digit code, formatted as typed or pasted. */
export function CodeField({
  variant = 'join',
  value,
  defaultValue,
  onValueChange,
  onComplete,
  ...rest
}: CodeFieldProps) {
  const [raw, setRaw] = useRaw(value, defaultValue);
  const full = variant === 'join' ? 8 : 6;
  const change = (e: ChangeEvent<HTMLInputElement>) => {
    const next =
      variant === 'join'
        ? normaliseJoinCode(e.target.value)
        : e.target.value.replace(/\D/g, '').slice(0, 6);
    if (next === raw) return;
    setRaw(next);
    onValueChange?.(next);
    if (next.length === full) onComplete?.(next);
  };
  return (
    <Input
      {...rest}
      type="text"
      inputMode={variant === 'join' ? 'text' : 'numeric'}
      autoComplete="one-time-code"
      autoCapitalize="characters"
      autoCorrect="off"
      spellCheck={false}
      maxLength={variant === 'join' ? 9 : 6}
      value={variant === 'join' ? formatJoinCode(raw) : raw}
      onChange={change}
      className="fs-code-input"
    />
  );
}

/** Parse what someone typed into "HH:MM" (24 h), or null when it is not a time. */
export function parseTime24(input: string): string | null {
  const m = input.trim().match(/^(\d{1,2})[:.\s]?(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

export interface TimeFieldProps extends Base {
  /** "HH:MM", 24 h. */
  value?: string | undefined;
  defaultValue?: string | undefined;
  /** Called with "HH:MM" while typing, and with the tidied value on blur ("9:05" -> "09:05"). */
  onValueChange?: ((value: string) => void) | undefined;
}

/**
 * A 24 h time typed as digits ("1002" shows "10:02"). A plain text input, not `type=time`, so
 * the clock never turns into AM/PM on phones set to English (India).
 */
export function TimeField({
  value,
  defaultValue,
  onValueChange,
  onBlur,
  placeholder = '10:00',
  ...rest
}: TimeFieldProps) {
  const [raw, setRaw] = useRaw(value, defaultValue);
  const emit = (v: string) => {
    setRaw(v);
    onValueChange?.(v);
  };
  const change = (e: ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 4);
    const typedColon = e.target.value.includes(':');
    const next =
      digits.length > 2 || (typedColon && digits.length === 2)
        ? `${digits.slice(0, 2)}:${digits.slice(2)}`
        : digits;
    emit(next);
  };
  const blur = (e: FocusEvent<HTMLInputElement>) => {
    const tidy = parseTime24(raw);
    if (tidy && tidy !== raw) emit(tidy);
    onBlur?.(e);
  };
  return (
    <Input
      {...rest}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      maxLength={5}
      placeholder={placeholder}
      start={<Icon name="clock" />}
      value={raw}
      onChange={change}
      onBlur={blur}
      className="tabular-nums"
    />
  );
}
