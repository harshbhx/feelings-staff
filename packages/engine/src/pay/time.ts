/**
 * The time lines of a payslip (PRD 7.5-7.7, 7.13): late and early undertime, overtime pay and the
 * extra for off-day work, with the minute totals behind them. A pure stage of computePayslip with its
 * own input and output, so Time credits (PRD 7.17) can replace the late/early and overtime parts.
 *
 * Cap order (PRD 7.10): the overtime and off-day lines are earnings and join gross pay; undertime is
 * time not worked, so the caller deducts it in full next to absence, before the 50% cap room.
 */
import type { DayResult, OtDecision, OtRate, WorkedOffDayComp } from '@fs/contracts';
import {
  formatInr,
  formatNum,
  formatRate,
  frac,
  fromDecimal,
  mul,
  type Q,
  sub,
  sum,
  toPaise,
} from '../money';
import { grouped, plural } from './shared';

/** A day's status for pay, after OPEN days count as present and sandwiched off days become LOP. */
export type PayStatus = 'P' | 'H' | 'A' | 'L' | 'LOP' | 'WO' | 'HO';

/** The salary part a day falls in: its position in the month and its exact daily rate. */
export interface RatePart {
  index: number;
  monthly: boolean;
  /** r_day for monthly staff, R for daily-wage staff (exact). */
  rate: Q;
}

export interface TimeDay {
  day: DayResult;
  status: PayStatus;
  part: RatePart;
  /** The off day is paid anyway: monthly staff, or a paid week-off or holiday for daily staff. */
  offPaid: boolean;
  /** How a worked off day with credit is rewarded (PRD 7.7): extra pay, comp-off or both. */
  offMode: WorkedOffDayComp;
}

export interface TimeLinesInput {
  days: readonly TimeDay[];
  /** Owner decisions per date; `auto` rows are ignored (pre-approved minutes are paid already). */
  approvals: readonly OtDecision[];
  otRate: OtRate;
  /** S_std, the standard day in minutes; overtime is always valued on it (PRD 7.6). */
  stdMin: number;
  offdayMultiplier: number;
}

export interface TimeLine {
  code: 'overtime' | 'offday_extra';
  amountPaise: number;
  formula: string;
}

export interface TimeLinesResult {
  /** Earning lines in payslip order: overtime, then the extra for off-day work. */
  earnings: TimeLine[];
  /** Late and early (PRD 7.5), exact and not yet limited to the pay left after absence. */
  undertime: { amount: Q; formula: string };
  lateBillableMin: number;
  earlyBillableMin: number;
  otApprovedMin: number;
  otPendingMin: number;
  compOffEarned: number;
}

/**
 * Undertime per salary part and S_day (`r_day × u / S_day`, PRD 7.5), approved overtime per part
 * (`r_day × m × min / S_std` at a multiplier, a flat hourly rate, comp-off or unpaid, PRD 7.6) and
 * the off-day extra (`r_day × (mult − 1) × credit` when the day is paid anyway, else
 * `R × mult × credit`, PRD 7.7). Each line is the exact sum rounded once.
 */
export function timeLines(input: TimeLinesInput): TimeLinesResult {
  const decisions = new Map(
    input.approvals.filter((a) => a.decision !== 'auto').map((a) => [a.workDate, a]),
  );
  const ut = new Map<string, { rate: Q; sDay: number; min: number }>();
  const ot = new Map<string, { rate: Q; min: number }>();
  const off = new Map<string, { rate: Q; factor: Q; text: string; credit: number }>();
  let lateBillableMin = 0;
  let earlyBillableMin = 0;
  let otApprovedMin = 0;
  let otPendingMin = 0;
  let compOffEarned = 0;

  for (const { day: d, status, part, offPaid, offMode } of input.days) {
    if (status === 'P') {
      lateBillableMin += d.lateBillableMin;
      earlyBillableMin += d.earlyBillableMin;
    }
    if (d.undertimeMin > 0) {
      const sDay = Math.max(1, d.scheduledMin);
      const key = `${part.index}|${sDay}`;
      grouped(ut, key, () => ({ rate: part.rate, sDay, min: 0 })).min += d.undertimeMin;
    }

    const decision = decisions.get(d.workDate);
    const decided = decision === undefined ? 0 : Math.min(decision.approvedMin, d.otCandidateMin);
    const approved = d.otPreapprovedMin + decided;
    otPendingMin += decision === undefined ? d.otCandidateMin : 0;
    otApprovedMin += approved;
    grouped(ot, String(part.index), () => ({ rate: part.rate, min: 0 })).min += approved;

    // Worked a weekly off or holiday with credit (PRD 7.7): extra pay and/or comp-off.
    if (d.offdayCredit > 0) {
      if (offMode !== 'comp_off') {
        const alreadyPaid = offPaid ? 1 : 0;
        const factor = sub(fromDecimal(input.offdayMultiplier), frac(alreadyPaid));
        const m = formatNum(input.offdayMultiplier);
        const text = alreadyPaid ? `(${m} − 1)` : m;
        grouped(off, `${part.index}|${alreadyPaid}`, () => ({
          rate: part.rate,
          factor,
          text,
          credit: 0,
        })).credit += d.offdayCredit;
      }
      if (offMode !== 'extra_pay') compOffEarned += d.offdayCredit;
    }
  }

  const earnings: TimeLine[] = [];
  const otTerms = [...ot.values()].filter((t) => t.min > 0);
  const rate = input.otRate;
  const stdMin = Math.max(1, input.stdMin);
  if (rate.mode === 'multiplier') {
    const m = fromDecimal(rate.multiplier);
    const amount = sum(otTerms.map((t) => mul(mul(t.rate, m), frac(t.min, stdMin))));
    const formula = otTerms
      .map(
        (t) => `${formatRate(t.rate)} × ${formatNum(rate.multiplier)} × ${t.min} min ÷ ${stdMin}`,
      )
      .join(' + ');
    if (otApprovedMin > 0)
      earnings.push({ code: 'overtime', amountPaise: toPaise(amount), formula });
  } else if (rate.mode === 'flat') {
    const amount = frac(rate.paisePerHour * otApprovedMin, 60);
    const formula = `${formatInr(rate.paisePerHour)} an hour × ${formatNum(otApprovedMin / 60)} h`;
    if (otApprovedMin > 0)
      earnings.push({ code: 'overtime', amountPaise: toPaise(amount), formula });
  } else if (rate.mode === 'comp_off') {
    // Every 4 hours of approved overtime is half a comp-off day (PRD 7.6).
    compOffEarned += Math.floor(otApprovedMin / 240) / 2;
  }

  const offTerms = [...off.values()];
  if (offTerms.length > 0) {
    const amount = sum(offTerms.map((t) => mul(mul(t.rate, t.factor), fromDecimal(t.credit))));
    const formula = offTerms
      .map((t) => `${formatRate(t.rate)} × ${t.text} × ${plural(t.credit, 'day')}`)
      .join(' + ');
    earnings.push({ code: 'offday_extra', amountPaise: toPaise(amount), formula });
  }

  const utTerms = [...ut.values()];
  return {
    earnings,
    undertime: {
      amount: sum(utTerms.map((t) => mul(t.rate, frac(t.min, t.sDay)))),
      formula: utTerms.map((t) => `${formatRate(t.rate)} × ${t.min} min ÷ ${t.sDay}`).join(' + '),
    },
    lateBillableMin,
    earlyBillableMin,
    otApprovedMin,
    otPendingMin,
    compOffEarned,
  };
}
