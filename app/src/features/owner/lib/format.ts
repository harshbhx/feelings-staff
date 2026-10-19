/**
 * Formatting for owner screens (PRD 5 copy tone): times `10:02` in IST, durations `9 h 05 m`,
 * money `₹15,000` with Indian grouping, dates `Mon 19 Oct`. Thin wrappers so screens stay short.
 */
import { formatDuration, formatRupees, istDate, istTime } from '@fs/contracts';
import { formatDate, formatMonth } from '@fs/i18n';

/** `10:02` in IST, whatever the device's time zone. */
export const clock = (ts: number): string => istTime(ts);

/** `9 h 05 m`, `18 m`. */
export const duration = (min: number): string => formatDuration(min);

/** `₹15,000` (paise dropped when zero) or `₹14,032.50`. */
export const money = (paise: number): string => formatRupees(paise, { whole: true });

/** `Mon 19 Oct`. */
export const dayLabel = (date: string): string => formatDate(date, 'en', 'weekday');

/** `19 Oct`. */
export const shortDate = (date: string): string => formatDate(date, 'en', 'short');

/** `19 October 2026`. */
export const longDate = (date: string): string => formatDate(date, 'en', 'long');

/** `October 2026`. */
export const monthLabel = (month: string): string => formatMonth(month, 'en');

/** `October` (month name only, for buttons such as "Finalise October"). */
export function monthName(month: string): string {
  return formatMonth(month, 'en').split(' ')[0] ?? month;
}

/** Today in IST for a client clock. */
export const todayIst = (now: number = Date.now()): string => istDate(now);

/** Hours with one decimal for tables (`2.5 h`); whole hours drop the decimal. */
export function hours(min: number): string {
  const h = Math.round((min / 60) * 10) / 10;
  return Number.isInteger(h) ? `${h} h` : `${h.toFixed(1)} h`;
}

/** Half-day counts: `1`, `1.5`, `0.5`. */
export function days(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** "Just now", "2 min ago", "3 h ago", or the date for older events. */
export function ago(
  ts: number,
  now: number,
  t: (k: string, o?: Record<string, unknown>) => string,
) {
  const min = Math.max(0, Math.floor((now - ts) / 60_000));
  if (min < 1) return t('owner:time.justNow');
  if (min < 60) return t('owner:time.minAgo', { count: min });
  const h = Math.floor(min / 60);
  if (h < 24) return t('owner:time.hAgo', { count: h });
  return shortDate(istDate(ts));
}
