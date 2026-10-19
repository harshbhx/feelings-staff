/** Phone, code, PIN and money helpers shared by client and server. */

/** Normalise an Indian mobile number to E.164 (`+91XXXXXXXXXX`), or null if it is not one. */
export function normaliseIndianPhone(input: string): string | null {
  let digits = input.replace(/[^\d+]/g, '');
  if (digits.startsWith('+91')) digits = digits.slice(3);
  else if (digits.startsWith('0091')) digits = digits.slice(4);
  else if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  digits = digits.replace(/\D/g, '');
  return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : null;
}

/** `+919876543210` -> `98765 43210`. */
export function formatIndianPhone(e164: string): string {
  const d = e164.replace(/^\+91/, '');
  return d.length === 10 ? `${d.slice(0, 5)} ${d.slice(5)}` : e164;
}

/** Crockford base32 alphabet (no I, L, O, U). */
export const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Normalise a typed join or pairing code: uppercase, drop separators, map I/L to 1 and O to 0. */
export function normaliseCode(input: string, length = 8): string | null {
  const s = input.toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
  if (s.length !== length) return null;
  for (const ch of s) if (!CROCKFORD.includes(ch)) return null;
  return s;
}

/** `K7M4QPXD` -> `K7M-4QPXD` (shown as XXX-XXXXX). */
export function formatJoinCode(code: string): string {
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}

export type PinProblem = 'format' | 'same_digit' | 'sequence' | 'phone_digits';

/** PIN rules from PRD 4.1.4. Returns the first problem, or null when the PIN is acceptable. */
export function pinProblem(pin: string, phoneE164?: string | null): PinProblem | null {
  if (!/^\d{4,6}$/.test(pin)) return 'format';
  if (/^(\d)\1+$/.test(pin)) return 'same_digit';
  const digits = [...pin].map(Number);
  const asc = digits.every((d, i) => i === 0 || d === ((digits[i - 1] as number) + 1) % 10);
  const desc = digits.every((d, i) => i === 0 || d === ((digits[i - 1] as number) + 9) % 10);
  if (asc || desc) return 'sequence';
  if (phoneE164?.endsWith(pin)) return 'phone_digits';
  return null;
}

const inr = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inrWhole = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/** `150000` paise -> `₹1,500.00`; with `whole`, drops paise when they are zero (`₹1,500`). */
export function formatRupees(paise: number, opts: { whole?: boolean } = {}): string {
  const sign = paise < 0 ? '−' : '';
  const abs = Math.abs(paise);
  const body = opts.whole && abs % 100 === 0 ? inrWhole.format(abs / 100) : inr.format(abs / 100);
  return `${sign}₹${body}`;
}

/** Minutes -> `9 h 05 m` (PRD 5 copy tone). */
export function formatDuration(min: number): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r} m`;
  return `${h} h ${String(r).padStart(2, '0')} m`;
}

/** First name + initial, e.g. "Priya Shah" -> "Priya S.". */
export function nameWithInitial(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1] : undefined;
  return last ? `${first} ${last.charAt(0).toUpperCase()}.` : first;
}

/** Initials for avatars, max 2 letters. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.charAt(0) ?? '';
  const b = parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? '') : '';
  return (a + b).toUpperCase();
}
