/**
 * Time credits (PRD 7.17): a minute ledger for the owner. One credit is one minute: minus for late,
 * early leave and owner-confirmed away time on P days, plus for owner-approved overtime. Nothing is cut
 * or paid automatically; the owner settles any part of the balance at payroll at the 1x per-minute
 * rate, inside the 50% deduction cap, and the rest carries over. Pure and deterministic.
 */
import type {
  ConfirmedAway,
  CreditAdjustment,
  CreditEntry,
  CreditEntryDraft,
  CreditRules,
  CreditSettlement,
  CreditSettlementResult,
  DayResult,
  MinuteRate,
  PersonPay,
} from '@fs/contracts';
import { daysInMonth, isoWeekOf } from '@fs/contracts';
import { frac, mul, type Q, toPaise } from '../money';
import { dailyRate, divisorDays } from '../pay/helpers';

/**
 * `credits_on(person, date)` (PRD 7.17.1): the salon setting is on, the date is on or after its start
 * date, and the person is not excluded (`staff_profiles.time_credits` 0; null follows the salon).
 */
export function creditsOn(
  setting: { enabled: boolean; startDate: string | null },
  person: boolean | null,
  date: string,
): boolean {
  return (
    setting.enabled && person !== false && (setting.startDate === null || date >= setting.startDate)
  );
}

/**
 * The ledger entries a day produces when Time credits is on for it (PRD 7.17.2). Minus entries only
 * on P days, from the first minute (no grace, no tolerance): the raw late and early minutes and each
 * counted away interval of the day. The plus entry is the overtime the owner approved, on any day.
 * Over-break, pending and rejected overtime give nothing. Entries are never 0.
 */
export function creditEntriesForDay(
  day: DayResult,
  away: readonly ConfirmedAway[],
  rules: CreditRules,
): CreditEntryDraft[] {
  if (!rules.enabled || day.status === 'NE') return [];
  const out: CreditEntryDraft[] = [];
  const base = { workDate: day.workDate };
  if (day.status === 'P') {
    if (day.lateMin > 0) {
      out.push({
        ...base,
        kind: 'late',
        minutes: -day.lateMin,
        sourceKind: 'punch',
        sourceId: rules.lateSourceId ?? '',
        confirmed: false,
      });
    }
    if (day.earlyMin > 0) {
      out.push({
        ...base,
        kind: 'early',
        minutes: -day.earlyMin,
        sourceKind: 'punch',
        sourceId: rules.earlySourceId ?? '',
        confirmed: false,
      });
    }
    const counted = away
      .filter((a) => a.workDate === day.workDate && a.minutes > 0)
      .sort((a, b) => a.startTs - b.startTs || a.id.localeCompare(b.id));
    for (const a of counted) {
      out.push({
        ...base,
        kind: 'away',
        minutes: -a.minutes,
        sourceKind: 'presence',
        sourceId: a.id,
        confirmed: true,
      });
    }
  }
  if (rules.otApprovedMin > 0) {
    out.push({
      ...base,
      kind: 'ot',
      minutes: rules.otApprovedMin,
      sourceKind: 'ot_decision',
      sourceId: rules.otSourceId ?? '',
      confirmed: true,
    });
  }
  return out;
}

const monthEnd = (month: string) => `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;

/**
 * Balance in signed minutes on `asOf` (PRD 7.17.3): active entries and active adjustments dated on or
 * before it, minus the applied minutes of finalised settlements whose month ends on or before it.
 * There is no monthly reset; the balance may change sign.
 */
export function creditBalance(
  entries: readonly Pick<CreditEntry, 'workDate' | 'minutes' | 'status'>[],
  adjustments: readonly Pick<CreditAdjustment, 'workDate' | 'deltaMin' | 'status'>[],
  settlements: readonly Pick<CreditSettlement, 'month' | 'appliedMin' | 'status'>[],
  asOf: string,
): number {
  let total = 0;
  for (const e of entries) if (e.status === 'active' && e.workDate <= asOf) total += e.minutes;
  for (const a of adjustments) if (a.status === 'active' && a.workDate <= asOf) total += a.deltaMin;
  for (const s of settlements) {
    if (s.status === 'applied' && monthEnd(s.month) <= asOf) total -= s.appliedMin;
  }
  return total;
}

const rDayQ = (rate: MinuteRate): Q => frac(rate.rDay.num, rate.rDay.den);

/**
 * Money of `minutes` at the 1x rate (PRD 7.17.4): `r_day × m / S_std`, signed paise, rounded once
 * half up (ties away from zero, so a minus value mirrors the plus one).
 */
export function creditValue(minutes: number, rate: MinuteRate): number {
  return toPaise(mul(rDayQ(rate), frac(minutes, rate.sStd)));
}

/**
 * The run month's per-minute rate (PRD 7.17.4): `r_day` of the salary in effect on the last day of
 * the month (monthly `M / div`, daily-wage `R`) over the person's standard day.
 */
export function creditRate(person: PersonPay, month: string): MinuteRate {
  const last = person.salaryParts.reduce((_, p) => p);
  const q = dailyRate(
    last.type,
    last.amountPaise,
    divisorDays(person.divisor, month, person.workingDays),
  );
  return { rDay: { num: Number(q.n), den: Number(q.d) }, sStd: Math.max(1, person.stdMin) };
}

/**
 * The largest whole number of minutes whose value fits in `room` paise: round(r_day × a / S_std) ≤ room
 * holds exactly when 2 × num × a < (2 × room + 1) × den × S_std.
 */
function minutesThatFit(room: number, rate: MinuteRate): number {
  const num = BigInt(rate.rDay.num);
  if (num <= 0n) return Number.MAX_SAFE_INTEGER;
  const limit = (2n * BigInt(Math.max(0, room)) + 1n) * BigInt(rate.rDay.den) * BigInt(rate.sStd);
  return Number((limit - 1n) / (2n * num));
}

/**
 * Settle part of a balance at payroll (PRD 7.17.5). `settleMin` is signed like the balance and is
 * kept to `0 ≤ |s| ≤ |B|` (the other sign settles nothing). A plus settlement is an earning of
 * `value(s)`. A minus settlement is a cut, first inside the 50% cap room: the largest whole number of
 * minutes `a ≤ |s|` with `value(a) ≤ room` is applied, and the rest stays on the balance.
 * `stayMin` is the signed balance left after this settlement.
 */
export function settleCredits(input: {
  balanceMin: number;
  settleMin: number;
  room: number;
  rate: MinuteRate;
}): CreditSettlementResult {
  const { balanceMin: b, rate } = input;
  const sign = Math.sign(b);
  const wanted = sign !== 0 && Math.sign(input.settleMin) === sign ? Math.abs(input.settleMin) : 0;
  const s = Math.min(wanted, Math.abs(b));
  const a = sign < 0 ? Math.min(s, minutesThatFit(input.room, rate)) : s;
  const appliedMin = a === 0 ? 0 : sign * a;
  return { appliedMin, amountPaise: creditValue(appliedMin, rate), stayMin: b - appliedMin };
}

export interface LegalHoursWarning {
  /** `daily_hours` past 9 h on a date, `weekly_hours` past 48 h in a Monday-Sunday week. */
  code: 'daily_hours' | 'weekly_hours';
  /** The work date, or the ISO week (`2026-W43`). */
  period: string;
  minutes: number;
}

/**
 * Passive legal-hours warnings (PRD 7.17.7, 7.6): hours at the salon should never pass 9 h a day or
 * 48 h a week, so Time credits has no 2x logic and only warns. Hours of a day are the worked minutes
 * plus its overtime minutes (pre-approved and candidates), as in the payroll weekly warning.
 */
export function legalOvertime(
  days: readonly Pick<
    DayResult,
    'workDate' | 'dayType' | 'workedMin' | 'otPreapprovedMin' | 'otCandidateMin'
  >[],
  limits: { dayMin: number; weekMin: number } = { dayMin: 9 * 60, weekMin: 48 * 60 },
): LegalHoursWarning[] {
  const daily: LegalHoursWarning[] = [];
  const weeks = new Map<string, number>();
  for (const d of [...days].sort((a, b) => a.workDate.localeCompare(b.workDate))) {
    if (d.dayType === 'NE') continue;
    const min = d.workedMin + d.otPreapprovedMin + d.otCandidateMin;
    if (min > limits.dayMin) daily.push({ code: 'daily_hours', period: d.workDate, minutes: min });
    const week = isoWeekOf(d.workDate);
    weeks.set(week, (weeks.get(week) ?? 0) + min);
  }
  const weekly = [...weeks.entries()]
    .filter(([, min]) => min > limits.weekMin)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([week, min]): LegalHoursWarning => ({ code: 'weekly_hours', period: week, minutes: min }),
    );
  return [...daily, ...weekly];
}
