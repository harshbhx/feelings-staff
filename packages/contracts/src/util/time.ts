/**
 * IST helpers (PRD 7.2). India has no DST, so IST is a fixed UTC+05:30 offset.
 * Instants are UTC epoch ms; dates are `YYYY-MM-DD`; wall-clock times are `HH:MM`.
 */
export const IST_OFFSET_MS = 330 * 60_000;
export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** IST calendar date of an instant. */
export function istDate(ts: number): string {
  const d = new Date(ts + IST_OFFSET_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** IST wall-clock `HH:MM` of an instant (seconds dropped, i.e. floored). */
export function istTime(ts: number): string {
  const d = new Date(ts + IST_OFFSET_MS);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** IST month `YYYY-MM` of an instant. */
export function istMonth(ts: number): string {
  return istDate(ts).slice(0, 7);
}

/** Epoch ms of a date + `HH:MM` in IST. `dayOffset` moves to the next day for past-midnight ends. */
export function istToEpoch(date: string, hhmm: string, dayOffset = 0): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = hhmm.split(':').map(Number) as [number, number];
  return Date.UTC(y, m - 1, d + dayOffset, hh, mm) - IST_OFFSET_MS;
}

/** Epoch ms of IST midnight starting `date`. */
export function istStartOfDay(date: string): number {
  return istToEpoch(date, '00:00');
}

/** Floor an instant to the whole minute (PRD 7.1: 10:10:59 counts as 10:10). */
export function floorToMinute(ts: number): number {
  return ts - (((ts % MINUTE_MS) + MINUTE_MS) % MINUTE_MS);
}

/** `HH:MM` to minutes after midnight. */
export function hhmmToMin(hhmm: string): number {
  const [hh, mm] = hhmm.split(':').map(Number) as [number, number];
  return hh * 60 + mm;
}

/** Minutes after midnight to `HH:MM` (wraps at 24 h). */
export function minToHhmm(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/** Add days to a `YYYY-MM-DD` date. */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Weekday of a date, 0 = Sunday. */
export function weekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Number of days in `YYYY-MM`. */
export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Every date in `YYYY-MM`. */
export function monthDates(month: string): string[] {
  const n = daysInMonth(month);
  return Array.from({ length: n }, (_, i) => `${month}-${pad(i + 1)}`);
}

/** Previous month of `YYYY-MM`. */
export function prevMonth(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
}

/** Next month of `YYYY-MM`. */
export function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`;
}

/** ISO week `YYYY-Www` containing a date. */
export function isoWeekOf(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d));
  const dow = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dow);
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((t.getTime() - yearStart) / DAY_MS + 1) / 7);
  return `${t.getUTCFullYear()}-W${pad(week)}`;
}

/** The seven dates (Monday first) of an ISO week. */
export function isoWeekDates(week: string): string[] {
  const [ys, ws] = week.split('-W') as [string, string];
  const y = Number(ys);
  const w = Number(ws);
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const jan4Dow = jan4.getUTCDay() || 7;
  const monday = Date.UTC(y, 0, 4 - jan4Dow + 1 + (w - 1) * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const t = new Date(monday + i * DAY_MS);
    return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
  });
}

/** Inclusive list of dates between two dates. */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
