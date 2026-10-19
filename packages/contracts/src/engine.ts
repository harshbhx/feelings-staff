/**
 * Types shared by the pure rules engine (packages/engine) and its callers (PRD 7.16).
 * All instants are UTC epoch ms, all wall-clock times are IST `HH:MM`, all money is integer paise,
 * all durations are whole minutes. Zod schemas exist so stored snapshots can be validated.
 */
import { z } from 'zod';
import {
  AwayEndReason,
  AwayReason,
  AwaySource,
  AwayState,
  CreditAdjustmentStatus,
  CreditKind,
  CreditSettlementStatus,
  CreditSourceKind,
  DayStatus,
  DayTag,
  DayType,
  Divisor,
  FenceResult,
  LeaveCode,
  OverrideStatus,
  PayslipLineCode,
  PresenceCheckResult,
  PunchKind,
  PunchSource,
  PunchStatus,
  RiskReason,
  RollCallMarkValue,
  SalaryType,
  WorkedOffDayComp,
} from './enums';
import {
  EpochMs,
  HalfDays,
  HHMM,
  Id,
  Lat,
  Lng,
  Minutes,
  Paise,
  WorkDate,
  YearMonth,
} from './primitives';
import { OtRate } from './settings';

/** One shift segment. `end` earlier than `start` means it ends after midnight. */
export const Segment = z.object({ start: HHMM, end: HHMM });
export type Segment = z.infer<typeof Segment>;

export const TemplateRule = z.object({
  id: Id,
  name: z.string(),
  segments: z.array(Segment).min(1),
  breakMin: z.number().int().min(0).max(180),
});
export type TemplateRule = z.infer<typeof TemplateRule>;

/** What resolveSchedule needs to know about the person. */
export const PersonPolicy = z.object({
  userId: Id,
  joinDate: WorkDate,
  exitDate: WorkDate.nullable(),
  weekOffDow: z.number().int().min(0).max(6).nullable(),
  defaultTemplate: TemplateRule,
});
export type PersonPolicy = z.infer<typeof PersonPolicy>;

export const RosterOverrideRule = z.object({
  date: WorkDate,
  kind: z.enum(['template', 'week_off', 'no_shift']),
  template: TemplateRule.nullable(),
});
export type RosterOverrideRule = z.infer<typeof RosterOverrideRule>;

export const HolidayRule = z.object({
  date: WorkDate,
  name: z.string(),
  paid: z.boolean(),
  workedComp: WorkedOffDayComp,
});
export type HolidayRule = z.infer<typeof HolidayRule>;

/** The org calendar for one person: their roster overrides plus org holidays. */
export const OrgCalendar = z.object({
  holidays: z.array(HolidayRule),
  rosterOverrides: z.array(RosterOverrideRule),
});
export type OrgCalendar = z.infer<typeof OrgCalendar>;

export const AbsSegment = z.object({ startTs: EpochMs, endTs: EpochMs });
export type AbsSegment = z.infer<typeof AbsSegment>;

export const DaySchedule = z.object({
  userId: Id,
  workDate: WorkDate,
  dayType: DayType,
  templateId: Id.nullable(),
  templateName: z.string().nullable(),
  /** Absolute segments for this date (empty on WO, HO, NE and "no shift"). */
  segments: z.array(AbsSegment),
  breakMin: z.number().int(),
  /** S_day: sum of segment minutes minus the unpaid break. */
  scheduledMin: Minutes,
  /** S_std: S_day of the person's default template. */
  stdMin: Minutes,
  holiday: HolidayRule.nullable(),
  /** True when a segment starts before 06:00 or ends after 21:00 (PRD 7.11). */
  nightHours: z.boolean(),
});
export type DaySchedule = z.infer<typeof DaySchedule>;

export const PunchForCalc = z.object({
  id: Id,
  kind: PunchKind,
  effectiveTs: EpochMs,
  status: PunchStatus,
  source: PunchSource,
  offsiteDutyId: Id.nullable(),
});
export type PunchForCalc = z.infer<typeof PunchForCalc>;

/** A pre-approved overtime window: an off-site duty with OT on, or an explicit pre-approval. */
export const OtWindow = z.object({
  startTs: EpochMs,
  endTs: EpochMs,
  source: z.enum(['duty', 'preapproval']),
  refId: Id,
});
export type OtWindow = z.infer<typeof OtWindow>;

export const LeaveOnDay = z.object({
  code: LeaveCode,
  paid: z.boolean(),
  half: z.enum(['none', 'first', 'second']),
  requestId: Id.nullable(),
});
export type LeaveOnDay = z.infer<typeof LeaveOnDay>;

export const DayOverride = z.object({
  status: OverrideStatus.optional(),
  leaveCode: LeaveCode.optional(),
  reason: z.string(),
  byUserId: Id,
  at: EpochMs,
});
export type DayOverride = z.infer<typeof DayOverride>;

/** Rules used by computeDay; built from OrgSettings by the caller. */
export const TimeRules = z.object({
  graceMin: z.number().int(),
  earlyToleranceMin: z.number().int(),
  makeupEnabled: z.boolean(),
  presentPct: z.number(),
  halfPct: z.number(),
  breakAfterMin: z.number().int(),
  breakPunches: z.boolean(),
  otThresholdMin: z.number().int(),
  otBlockMin: z.number().int(),
  /**
   * Time credits are on for this day (PRD 7.17.1): `computeDay` then returns undertime 0, makeup 0,
   * no overtime pay minutes, and the raw late, early and over-break minutes. Absent means off.
   */
  credits: z.boolean().optional(),
});
export type TimeRules = z.infer<typeof TimeRules>;

export const DayResult = z.object({
  version: z.string(),
  userId: Id,
  workDate: WorkDate,
  dayType: DayType,
  templateId: Id.nullable(),
  scheduledMin: Minutes,
  workedMin: Minutes,
  breakMin: Minutes,
  lateMin: Minutes,
  lateBillableMin: Minutes,
  earlyMin: Minutes,
  earlyBillableMin: Minutes,
  overbreakMin: Minutes,
  makeupMin: Minutes,
  undertimeMin: Minutes,
  /** Minutes inside pre-approved windows, block-rounded; approved automatically. */
  otPreapprovedMin: Minutes,
  /** Other overtime candidates, block-rounded; need the owner's decision. */
  otCandidateMin: Minutes,
  status: DayStatus,
  leaveCode: LeaveCode.nullable(),
  /** Credit for presence on WO/HO (0, 0.5 or 1). */
  offdayCredit: z.union([z.literal(0), z.literal(0.5), z.literal(1)]),
  /** Minutes on WO/HO that did not reach half a day; they become overtime candidates. */
  offdayOtMin: Minutes,
  tags: z.array(DayTag),
  firstInTs: EpochMs.nullable(),
  lastOutTs: EpochMs.nullable(),
  /** True while an `in` has no matching `out`. */
  open: z.boolean(),
  /**
   * Every worked minute of the day, inside and outside the shift, after the break (PRD 7.17.7 legal
   * hours: 10:10 to 22:10 with a 60-min break is 660). Absent on results stored before engine 0.4.
   */
  totalMin: Minutes.optional(),
});
export type DayResult = z.infer<typeof DayResult>;

export const OtDecision = z.object({
  workDate: WorkDate,
  candidateMin: Minutes,
  approvedMin: Minutes,
  decision: z.enum(['approved', 'partial', 'rejected', 'auto']),
});
export type OtDecision = z.infer<typeof OtDecision>;

/** One salary period inside the month (split at salary_history.effective_from). */
export const SalaryPart = z.object({
  from: WorkDate,
  to: WorkDate,
  type: SalaryType,
  amountPaise: Paise,
});
export type SalaryPart = z.infer<typeof SalaryPart>;

export const PersonPay = z.object({
  userId: Id,
  joinDate: WorkDate,
  exitDate: WorkDate.nullable(),
  salaryParts: z.array(SalaryPart).min(1),
  divisor: Divisor,
  otRate: OtRate,
  stdMin: Minutes,
  /** Scheduled working days in the month (for the `working` divisor). */
  workingDays: z.number().int(),
});
export type PersonPay = z.infer<typeof PersonPay>;

export const AdvanceSchedule = z.object({
  advanceId: Id,
  /** Due this month: this month's instalment plus anything carried in. */
  duePaise: Paise,
  /** Owner may lower recovery this month (PRD 4.13.3); null = recover what is due. */
  overridePaise: Paise.nullable(),
});
export type AdvanceSchedule = z.infer<typeof AdvanceSchedule>;

export const Adjustment = z.object({
  id: Id,
  kind: z.enum([
    'incentive',
    'bonus',
    'other_earning',
    'arrears',
    'damage',
    'other_deduction',
    'recovery',
  ]),
  amountPaise: Paise,
  note: z.string(),
});
export type Adjustment = z.infer<typeof Adjustment>;

export const Fine = z.object({
  id: Id,
  amountPaise: Paise,
  fineDate: WorkDate,
});
export type Fine = z.infer<typeof Fine>;

export const CarryForward = z.object({
  advances: z.array(z.object({ advanceId: Id, paise: Paise })),
  damagePaise: Paise,
  otherPaise: Paise,
  fines: z.array(z.object({ fineId: Id, paise: Paise, fineDate: WorkDate })),
});
export type CarryForward = z.infer<typeof CarryForward>;

export const PayRules = z.object({
  offdayMultiplier: z.number(),
  weekOffWorked: z.enum(['comp_off', 'extra_pay']),
  sandwich: z.boolean(),
  dailyPaidHolidays: z.boolean(),
  dailyPaidWeekOffs: z.boolean(),
  capPct: z.number(),
  finesCapPct: z.number(),
  minimumWagePaise: Paise.nullable(),
  minimumWageBasis: z.enum(['monthly', 'daily']),
});
export type PayRules = z.infer<typeof PayRules>;

export const PayslipLine = z.object({
  code: PayslipLineCode,
  label: z.string(),
  /** Human formula, e.g. "15,000 / 31 days x 1.5 days". */
  formula: z.string(),
  /** Positive for earnings, negative for deductions. */
  amountPaise: Paise,
  kind: z.enum(['earning', 'deduction', 'rounding']),
  refId: z.string().nullable(),
});
export type PayslipLine = z.infer<typeof PayslipLine>;

export const PayslipWarning = z.object({
  code: z.enum([
    'min_wage',
    'weekly_hours',
    'quarterly_ot',
    'cap_carry',
    'absence_over_cap',
    'ot_multiplier_low',
    'pending_overtime',
    /** Owner only: legal-band overtime counted at 2x through Time credits (PRD 7.17.7). */
    'legal_ot_2x',
    /** Owner only: legal-band overtime counted at 1x because "Pay legal overtime at 2x" is off. */
    'legal_ot_shortfall',
  ]),
  message: z.string(),
  amountPaise: Paise.nullable(),
});
export type PayslipWarning = z.infer<typeof PayslipWarning>;

export const DayCounts = z.object({
  P: z.number().int(),
  H: z.number().int(),
  A: z.number().int(),
  L: HalfDays,
  LOP: HalfDays,
  WO: z.number().int(),
  HO: z.number().int(),
  NE: z.number().int(),
  paidDays: HalfDays,
  lopDays: HalfDays,
});
export type DayCounts = z.infer<typeof DayCounts>;

export const PayslipResult = z.object({
  version: z.string(),
  userId: Id,
  month: YearMonth,
  salaryType: SalaryType,
  daysInMonth: z.number().int(),
  employedDays: z.number().int(),
  divisorDays: z.number().int(),
  /** r_day rounded to the paisa, for display only (lines use exact fractions). */
  dailyRatePaise: Paise,
  counts: DayCounts,
  lateBillableMin: Minutes,
  earlyBillableMin: Minutes,
  otApprovedMin: Minutes,
  otPendingMin: Minutes,
  compOffEarned: HalfDays,
  lines: z.array(PayslipLine),
  grossPaise: Paise,
  deductionsPaise: Paise,
  netBeforeRoundingPaise: Paise,
  roundingPaise: Paise,
  netPaise: Paise,
  advanceRecoveries: z.array(
    z.object({ advanceId: Id, duePaise: Paise, recoveredPaise: Paise, carriedPaise: Paise }),
  ),
  carryOut: CarryForward,
  warnings: z.array(PayslipWarning),
});
export type PayslipResult = z.infer<typeof PayslipResult>;

/** A location fix summary sent with a punch (PRD 9.4). */
export const Fix = z.object({
  lat: Lat,
  lng: Lng,
  /** Accuracy radius (m) of the best fix. */
  accuracy: z.number().nonnegative(),
  /** Number of fixes collected. */
  samples: z.number().int().min(1),
  /** Largest distance (m) between any two collected fixes; 0 when all identical to 6 decimals. */
  spreadM: z.number().nonnegative(),
  /** Spread of the reported accuracy values (m); 0 when identical. */
  accuracySpreadM: z.number().nonnegative(),
  /** altitude and altitudeAccuracy null on every sample. */
  altitudeNullAll: z.boolean(),
  /** speed and heading null on every sample. */
  speedNullAll: z.boolean(),
});
export type Fix = z.infer<typeof Fix>;

export const SiteGeo = z.object({
  id: Id,
  lat: Lat,
  lng: Lng,
  radiusM: z.number().int(),
  maxAccuracyM: z.number().int(),
});
export type SiteGeo = z.infer<typeof SiteGeo>;

export const FenceCheck = z.object({ result: FenceResult, distanceM: z.number().nonnegative() });
export type FenceCheck = z.infer<typeof FenceCheck>;

export const RiskInput = z.object({
  fence: FenceResult,
  fix: Fix.nullable(),
  /** Best fixes of this person's punches in the last 14 days (for replay detection). */
  recentFixes: z.array(z.object({ lat: Lat, lng: Lng })),
  /** This person's previous punch fix within 12 h (for the impossible-jump check). */
  previousFix: z.object({ lat: Lat, lng: Lng, ts: EpochMs }).nullable(),
  nowTs: EpochMs,
  ipCountry: z.string().nullable(),
  ipAsn: z.number().int().nullable(),
  deviceTz: z.string().nullable(),
  clockSkewMs: z.number().int().nullable(),
  deviceApprovedAt: EpochMs.nullable(),
  offline: z.boolean(),
  salonNetworkMatch: z.boolean(),
  doorQrValid: z.boolean(),
  offsitePass: z.boolean(),
  flagAt: z.number().int(),
  proofAt: z.number().int(),
});
export type RiskInput = z.infer<typeof RiskInput>;

export const RiskResult = z.object({
  score: z.number().int(),
  reasons: z.array(RiskReason),
  outcome: z.enum(['accept', 'flag', 'proof', 'block']),
});
export type RiskResult = z.infer<typeof RiskResult>;

// ---- Time credits (PRD 7.16, 7.17) -------------------------------------------------------------

/** An exact fraction (numerator over a positive denominator), e.g. paise per day as `1500000 / 31`. */
export const Fraction = z.object({ num: z.number().int(), den: z.number().int().positive() });
export type Fraction = z.infer<typeof Fraction>;

/**
 * The per-minute rate of one person (PRD 7.17.4): `rDay` is the daily rate in paise as an exact
 * fraction, `sStd` the standard day in minutes. One minute = `rDay / sStd`, at 1x.
 */
export const MinuteRate = z.object({ rDay: Fraction, sStd: z.number().int().positive() });
export type MinuteRate = z.infer<typeof MinuteRate>;

/**
 * Input of `creditEntriesForDay` besides the day and the away intervals (PRD 7.17.1, 7.17.2). The
 * caller decides `enabled` per day (`credits_on`), supplies the overtime minutes the owner approved
 * for the day (preapproved plus decided) and the ids the entries point at.
 */
export const CreditRules = z.object({
  enabled: z.boolean(),
  /** Owner-approved overtime minutes of the day (any day type, including worked off-days). */
  otApprovedMin: Minutes,
  /** First `in` punch of the day (late entry source), null when there is none. */
  lateSourceId: z.string().nullable(),
  /** Last `out` punch of the day (early entry source), null when there is none. */
  earlySourceId: z.string().nullable(),
  /** The overtime decision (`ot_decisions.id`), or the preapproval or duty id (ot entry source). */
  otSourceId: z.string().nullable(),
  /**
   * Legal-band minutes of the day (`legalOtBand`, PRD 7.17.7), at most `otApprovedMin`: they give
   * an extra `ot_legal` entry. 0 or absent when "Pay legal overtime at 2x" is off.
   */
  legalOtMin: Minutes.optional(),
});
export type CreditRules = z.infer<typeof CreditRules>;

/** An away interval the owner counted: marked at a roll-call, or a confirmed step-out (PRD 7.18). */
export const ConfirmedAway = z.object({
  /** `away_intervals.id` (the `away` entry's source). */
  id: Id,
  workDate: WorkDate,
  startTs: EpochMs,
  endTs: EpochMs,
  /** Counted minutes, already clipped to the shift segments and presence (PRD 7.18 rule 3). */
  minutes: Minutes,
  confirmedBy: Id,
});
export type ConfirmedAway = z.infer<typeof ConfirmedAway>;

/** A credit entry as the engine derives it, before ids and timestamps are assigned. */
export const CreditEntryDraft = z.object({
  workDate: WorkDate,
  kind: CreditKind,
  /** Signed, never 0: minus for late, early and away, plus for ot. */
  minutes: Minutes.refine((m) => m !== 0, 'A credit entry is never 0'),
  sourceKind: CreditSourceKind,
  /** Punch id for late and early, the away interval id for away, the overtime decision for ot. */
  sourceId: z.string(),
  /** Away and ot entries are confirmed by the owner (or a manager for away); late and early are automatic. */
  confirmed: z.boolean(),
});
export type CreditEntryDraft = z.infer<typeof CreditEntryDraft>;

/** A stored `credit_entries` row. */
export const CreditEntry = CreditEntryDraft.omit({ confirmed: true }).extend({
  id: Id,
  userId: Id,
  confirmedBy: Id.nullable(),
  confirmedAt: EpochMs.nullable(),
  status: z.enum(['active', 'superseded']),
  engineVersion: z.string(),
  createdAt: EpochMs,
});
export type CreditEntry = z.infer<typeof CreditEntry>;

/** A stored `credit_adjustments` row: the owner's change to one day and kind (PRD 4.19.5). */
export const CreditAdjustment = z.object({
  id: Id,
  userId: Id,
  workDate: WorkDate,
  kind: CreditKind,
  /** Signed change in minutes, never 0. */
  deltaMin: Minutes.refine((m) => m !== 0, 'An adjustment is never 0'),
  reason: z.string(),
  status: CreditAdjustmentStatus,
  createdBy: Id,
  createdAt: EpochMs,
  voidedBy: Id.nullable(),
  voidedAt: EpochMs.nullable(),
  voidReason: z.string().nullable(),
});
export type CreditAdjustment = z.infer<typeof CreditAdjustment>;

/** A stored `credit_settlements` row (PRD 7.17.5). */
export const CreditSettlement = z.object({
  id: Id,
  userId: Id,
  payrollRunId: Id,
  /** Period end is the last day of this month. */
  month: YearMonth,
  /** Signed balance at the period end, before this step. */
  balanceMin: Minutes,
  /** The owner's choice, signed like the balance; 0 is allowed. */
  settleMin: Minutes,
  /** After the 50% cap. */
  appliedMin: Minutes,
  /** Signed: negative is a cut, positive an earning (1x value of `appliedMin`). */
  amountPaise: Paise,
  rate: MinuteRate,
  /** The payroll warnings that applied at the time of the step. */
  warnings: z.array(PayslipWarning),
  status: CreditSettlementStatus,
  decidedBy: Id,
  decidedAt: EpochMs,
  note: z.string().nullable(),
});
export type CreditSettlement = z.infer<typeof CreditSettlement>;

/** What `computePayslip` takes for one person's settlement (null: no settlement). */
export const CreditSettlementInput = z.object({
  /** Balance at the period end, signed. */
  balanceMin: Minutes,
  /** The owner's choice, signed like the balance. */
  settleMin: Minutes,
  /** The run month's `r_day` and the standard day (PRD 7.17.4). */
  rate: MinuteRate,
});
export type CreditSettlementInput = z.infer<typeof CreditSettlementInput>;

/** Result of `settleCredits` (PRD 7.17.5). */
export const CreditSettlementResult = z.object({
  appliedMin: Minutes,
  amountPaise: Paise,
  /** Minutes of the balance that stay unsettled (cap or choice). */
  stayMin: Minutes,
});
export type CreditSettlementResult = z.infer<typeof CreditSettlementResult>;

// ---- Presence (PRD 7.16, 7.18) -----------------------------------------------------------------

/** A half-open span of absolute time. */
export const Interval = z.object({ startTs: EpochMs, endTs: EpochMs });
export type Interval = z.infer<typeof Interval>;

/** One person's mark at one roll-call slot. */
export const RollCallMark = z.object({
  rollCallId: Id,
  userId: Id,
  slotTs: EpochMs,
  mark: RollCallMarkValue,
  markedBy: Id,
});
export type RollCallMark = z.infer<typeof RollCallMark>;

/** A staff Step out. `state` keeps the owner's decision when the day is recomputed. */
export const StepOut = z.object({
  id: Id,
  startTs: EpochMs,
  endTs: EpochMs.nullable(),
  reason: AwayReason,
  state: AwayState,
  /** The interval was closed by the next roll-call or check-out, not by I'm back. */
  backMissing: z.boolean(),
});
export type StepOut = z.infer<typeof StepOut>;

/** One foreground check. Only `outside` can raise a hint (PRD 7.18 rule 6). */
export const PresenceCheck = z.object({ ts: EpochMs, result: PresenceCheckResult });
export type PresenceCheck = z.infer<typeof PresenceCheck>;

/** An away interval as `buildAwayIntervals` returns it (PRD 7.18 rules 1 to 4). */
export const AwayInterval = z.object({
  startTs: EpochMs,
  /** Null while open. */
  endTs: EpochMs.nullable(),
  source: AwaySource,
  /** Step-out reason chip; null for a roll-call interval. */
  reason: AwayReason.nullable(),
  /** Minutes clipped to shift segments and presence, minus the break window; 0 while open. */
  minutes: Minutes,
  /** `confirmed` for roll-call, `open` or `pending` for step-outs unless the owner decided. */
  state: AwayState,
  endReason: AwayEndReason.nullable(),
  backMissing: z.boolean(),
  /** Roll-call and step-out rows merged into this interval. */
  rollCallIds: z.array(Id),
  stepOutIds: z.array(Id),
});
export type AwayInterval = z.infer<typeof AwayInterval>;

/** "Seems away" hint from an outside foreground check; never an interval, never credits. */
export const SeemsAway = z.object({ sinceTs: EpochMs, lastCheckTs: EpochMs });
export type SeemsAway = z.infer<typeof SeemsAway>;

/** Rules for `buildAwayIntervals`, built from `OrgSettings.presence` by the caller. */
export const PresenceRules = z.object({
  enabled: z.boolean(),
  /** Intervals shorter than this are dropped (5). */
  minAwayMin: z.number().int().min(0),
});
export type PresenceRules = z.infer<typeof PresenceRules>;
