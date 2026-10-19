/**
 * Leave rules (PRD 7.8): CL/SL proration for joiners, usable-after, comp-off expiry and FIFO use,
 * the sandwich rule, blackout days and the paid/unpaid split of a request. Pure helpers for the leave
 * service (WP-4), the comp-off expiry job (WP-8) and the payroll engine.
 */
import type { DayResult, DaySchedule, HalfDayPart } from '@fs/contracts';
import { addDays } from '@fs/contracts';
import { frac, fromDecimal, mul, type Q, roundHalfUp } from '../money';

/** Nearest 0.5, ties up (1.75 -> 2, 1.7 -> 1.5). */
export const roundHalf = (x: Q): number => Number(roundHalfUp(mul(x, frac(2)))) / 2;

/**
 * Annual quota for a year (CL/SL credited on 1 Jan). Joiners in that year get
 * `round_half(quota × months left including the joining month / 12)`; later joiners get nothing.
 */
export function quotaForYear(annual: number, joinDate: string, year: number): number {
  const joinYear = Number(joinDate.slice(0, 4));
  if (joinYear < year) return annual;
  if (joinYear > year) return 0;
  const monthsLeft = 13 - Number(joinDate.slice(5, 7));
  return roundHalf(mul(fromDecimal(annual), frac(monthsLeft, 12)));
}

/** First date leave can be used: joining date + the "usable after" days (default 90). */
export const leaveUsableFrom = (joinDate: string, usableAfterDays: number): string =>
  addDays(joinDate, usableAfterDays);

/** Last day a comp-off earned on `earnedOn` can be used (earned 20 Oct + 60 days = 19 Dec). */
export const compOffExpiresOn = (earnedOn: string, expiryDays: number): string =>
  addDays(earnedOn, expiryDays);

export interface CompOffEntry {
  date: string;
  kind: 'credit' | 'debit';
  days: number;
}

export interface CompOffLot {
  earnedOn: string;
  expiresOn: string;
  remaining: number;
}

export interface CompOffState {
  /** Usable on `asOf`, oldest first. */
  lots: CompOffLot[];
  balance: number;
  /** Lots that ran out unused by `asOf` (the expiry job writes these as `expire` ledger rows). */
  expired: CompOffLot[];
  /** Debits that found no usable comp-off. */
  overdrawn: number;
}

/**
 * Comp-off balance on a date (PRD 7.8): credits expire `expiryDays` after they are earned and are
 * used oldest first. A lot is usable through its expiry date.
 */
export function compOffState(
  entries: readonly CompOffEntry[],
  asOf: string,
  expiryDays: number,
): CompOffState {
  const sorted = [...entries].sort(
    (a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind),
  );
  const lots: CompOffLot[] = [];
  let overdrawn = 0;
  for (const e of sorted) {
    if (e.kind === 'credit') {
      lots.push({
        earnedOn: e.date,
        expiresOn: compOffExpiresOn(e.date, expiryDays),
        remaining: e.days,
      });
      continue;
    }
    let need = e.days;
    for (const lot of lots) {
      if (lot.expiresOn < e.date) continue;
      const take = Math.min(lot.remaining, need);
      lot.remaining -= take;
      need -= take;
    }
    overdrawn += need;
  }
  const live = lots.filter((l) => l.remaining > 0);
  const usable = live.filter((l) => l.expiresOn >= asOf);
  return {
    lots: usable,
    balance: usable.reduce((s, l) => s + l.remaining, 0),
    expired: live.filter((l) => l.expiresOn < asOf),
    overdrawn,
  };
}

type SandwichDay = Pick<DayResult, 'workDate' | 'dayType' | 'status' | 'workedMin'>;

/**
 * Sandwich rule (PRD 7.8, off by default): unworked WO/HO days with an absent or LOP working day
 * directly before and after (no worked day between) also become LOP. Expects consecutive dates.
 */
export function sandwichDates(days: readonly SandwichDay[]): string[] {
  const sorted = [...days].sort((a, b) => a.workDate.localeCompare(b.workDate));
  const out: string[] = [];
  let run: string[] = [];
  let unpaidBefore = false;
  for (const d of sorted) {
    if ((d.status === 'WO' || d.status === 'HO') && d.workedMin === 0) {
      run.push(d.workDate);
      continue;
    }
    const unpaid = d.dayType === 'work' && (d.status === 'A' || d.status === 'LOP');
    if (unpaid && unpaidBefore) out.push(...run);
    run = [];
    unpaidBefore = unpaid;
  }
  return out;
}

/** Leave days a request uses: working days only (WO, HO and NE are not counted); a half day is 0.5. */
export function leaveDays(
  days: readonly Pick<DaySchedule, 'dayType'>[],
  half: HalfDayPart,
): number {
  const n = days.filter((d) => d.dayType === 'work').length;
  return half === 'none' ? n : n / 2;
}

/** Paid part from the balance (in half days), the rest unpaid (PRD 4.9 "the other 1 day will be unpaid"). */
export function splitPaidUnpaid(
  requested: number,
  balance: number,
): { paid: number; unpaid: number } {
  const paid = Math.min(requested, Math.max(0, Math.floor(balance * 2) / 2));
  return { paid, unpaid: requested - paid };
}

/** Requested dates that fall on blackout days; the request is allowed but flagged to the owner. */
export function blackoutHits(dates: readonly string[], blackout: readonly string[]): string[] {
  const set = new Set(blackout);
  return dates.filter((d) => set.has(d));
}
