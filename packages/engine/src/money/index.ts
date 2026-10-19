/**
 * Money helpers (PRD 7.1, ADR-06). Amounts are integer paise. Rates are exact fractions with bigint
 * numerator and denominator; each payslip line is rounded once, to the paisa, half up (ties away from
 * zero). The net is rounded to the rupee the same way.
 */
export interface Q {
  readonly n: bigint;
  readonly d: bigint;
}

const abs = (x: bigint) => (x < 0n ? -x : x);

function gcd(a: bigint, b: bigint): bigint {
  let x = abs(a);
  let y = b;
  while (y > 0n) [x, y] = [y, x % y];
  return x;
}

/** n / d, reduced, with a positive denominator. Throws on a zero denominator. */
export function frac(n: bigint | number, d: bigint | number = 1n): Q {
  let nn = BigInt(n);
  let dd = BigInt(d);
  if (dd === 0n) throw new RangeError('Division by zero');
  if (dd < 0n) {
    nn = -nn;
    dd = -dd;
  }
  const g = gcd(nn, dd);
  return { n: nn / g, d: dd / g };
}

export const ZERO: Q = frac(0);

/** Exact fraction of a decimal setting such as 1.5 or 2.5 (up to 6 decimal places). */
export const fromDecimal = (x: number): Q => frac(Math.round(x * 1_000_000), 1_000_000);

export const add = (a: Q, b: Q): Q => frac(a.n * b.d + b.n * a.d, a.d * b.d);
export const sub = (a: Q, b: Q): Q => frac(a.n * b.d - b.n * a.d, a.d * b.d);
export const mul = (a: Q, b: Q): Q => frac(a.n * b.n, a.d * b.d);
export const div = (a: Q, b: Q): Q => frac(a.n * b.d, a.d * b.n);
export const sum = (qs: readonly Q[]): Q => qs.reduce(add, ZERO);

/** -1, 0 or 1. */
export function cmp(a: Q, b: Q): number {
  const x = a.n * b.d - b.n * a.d;
  return x === 0n ? 0 : x < 0n ? -1 : 1;
}
export const minQ = (a: Q, b: Q): Q => (cmp(a, b) <= 0 ? a : b);
export const maxQ = (a: Q, b: Q): Q => (cmp(a, b) >= 0 ? a : b);

/** Nearest integer, ties away from zero (2.5 -> 3, -2.5 -> -3). */
export function roundHalfUp(a: Q): bigint {
  const r = (2n * abs(a.n) + a.d) / (2n * a.d);
  return a.n < 0n ? -r : r;
}

/** Paise of an exact amount, rounded once (PRD 7.1). */
export const toPaise = (a: Q): number => Number(roundHalfUp(a));

/** Nearest whole rupee in paise, half up. */
export const roundToRupee = (paise: number): number => Number(roundHalfUp(frac(paise, 100))) * 100;

/** Indian digit grouping: 1234567 -> 12,34,567. */
function groupIndian(digits: string): string {
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3);
  return rest === '' ? last3 : `${rest.replace(/\B(?=(\d{2})+$)/g, ',')},${last3}`;
}

/**
 * "₹15,000", "₹483.87", "−₹0.26". Whole rupees drop the paise unless `always` is set (rates and
 * payslip amounts show both decimals; formulas read better without them).
 */
export function formatInr(paise: number, always = false): string {
  const neg = paise < 0;
  const a = Math.abs(paise);
  const rupees = groupIndian(String(Math.floor(a / 100)));
  const ps = a % 100;
  const body = always || ps !== 0 ? `${rupees}.${String(ps).padStart(2, '0')}` : rupees;
  return `${neg ? '−' : ''}₹${body}`;
}

/** A rate rounded to the paisa for reading only, e.g. "₹483.87" (line amounts use exact values). */
export const formatRate = (a: Q): string => formatInr(toPaise(a), true);

/** 1.5 -> "1.5", 2 -> "2". */
export const formatNum = (x: number): string => String(Number(x.toFixed(2)));
