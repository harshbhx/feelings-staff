/**
 * Glue between what people type and what the API takes (PRD 4.1.4). Parsing rules come from
 * `@fs/contracts` (normaliseIndianPhone, normaliseCode, pinProblem) so client and server agree.
 */
import {
  formatIndianPhone,
  formatJoinCode,
  normaliseCode,
  normaliseIndianPhone,
  type PinProblem,
  pinProblem,
} from '@fs/contracts';

export const STAFF_PIN = { min: 4, max: 6 } as const;
export const OWNER_PIN = { min: 6, max: 6 } as const;
export const EMAIL_CODE_LENGTH = 6;

/** `+919825011201` from "98250 11201", "+91 98250-11201" or "098250 11201"; null if not a mobile. */
export function parsePhone(raw: string): string | null {
  return normaliseIndianPhone(raw);
}

/** The 10 digits to show in the phone field (the field shows +91 itself). */
export function phoneForField(e164: string | null | undefined): string {
  return e164 ? formatIndianPhone(e164) : '';
}

/** `K7M4QPXD` from "k7m-4qpxd" (I/L read as 1, O as 0); null unless 8 valid characters. */
export function parseJoinCode(raw: string): string | null {
  return normaliseCode(raw, 8);
}

/** Live formatting while typing: uppercase, letters and digits only, a dash after 3 (`XXX-XXXXX`). */
export function formatCodeInput(raw: string): string {
  const s = raw
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .slice(0, 8);
  return s.length > 3 ? formatJoinCode(s) : s;
}

/** Digits only, at most `max` of them (PIN pad and code fields). */
export function digitsOnly(raw: string, max: number): string {
  return raw.replace(/\D/g, '').slice(0, max);
}

export function pinComplete(pin: string, len: { min: number; max: number }): boolean {
  return pin.length >= len.min && pin.length <= len.max && /^\d+$/.test(pin);
}

export type NewPinCheck = { ok: true } | { ok: false; reason: 'short' | PinProblem };

/** PIN rules for a new staff PIN (PRD 4.1.4): 4-6 digits, not easy to guess. */
export function checkNewPin(pin: string, phoneE164: string | null): NewPinCheck {
  if (pin.length < STAFF_PIN.min) return { ok: false, reason: 'short' };
  const problem = pinProblem(pin, phoneE164);
  return problem ? { ok: false, reason: problem } : { ok: true };
}

/** A plain email check for the owner form; the server has the final word. */
export function looksLikeEmail(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.trim());
}
