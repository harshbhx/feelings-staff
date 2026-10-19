/** Intl formatters in IST (PRD 5 copy tone: `10:02`, `9 h 05 m`, `₹15,000`, Indian grouping). */
import { formatDuration, formatRupees } from '@fs/contracts';
import type { AppLang } from './index';

const TZ = 'Asia/Kolkata';
const locale = (lang: AppLang) => (lang === 'gu' ? 'gu-IN' : 'en-IN');

export { formatDuration, formatRupees };

/** `10:02` (24 h, Latin digits). */
export function formatClock(ts: number): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(ts);
}

/** `Mon 19 Oct` / `19 October 2026`. */
export function formatDate(
  dateOrTs: string | number,
  lang: AppLang = 'en',
  style: 'short' | 'long' | 'weekday' = 'short',
): string {
  const ts = typeof dateOrTs === 'number' ? dateOrTs : Date.parse(`${dateOrTs}T12:00:00+05:30`);
  const opts: Intl.DateTimeFormatOptions =
    style === 'long'
      ? { day: 'numeric', month: 'long', year: 'numeric' }
      : style === 'weekday'
        ? { weekday: 'short', day: 'numeric', month: 'short' }
        : { day: 'numeric', month: 'short' };
  return new Intl.DateTimeFormat(locale(lang), {
    timeZone: TZ,
    numberingSystem: 'latn',
    ...opts,
  }).format(ts);
}

/** `October 2026` for `2026-10`. */
export function formatMonth(month: string, lang: AppLang = 'en'): string {
  return new Intl.DateTimeFormat(locale(lang), {
    timeZone: TZ,
    month: 'long',
    year: 'numeric',
    numberingSystem: 'latn',
  }).format(Date.parse(`${month}-15T12:00:00+05:30`));
}
