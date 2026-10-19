/**
 * Types shared by the pure rules engine (packages/engine) and its callers (PRD 7.16).
 * All instants are UTC epoch ms, all wall-clock times are IST `HH:MM`, all money is integer paise,
 * all durations are whole minutes. Zod schemas exist so stored snapshots can be validated.
 */
import { z } from 'zod';
import {
  DayStatus,
  DayTag,
  DayType,
  Divisor,
  FenceResult,
  LeaveCode,
  OverrideStatus,
  PayslipLineCode,
  PunchKind,
  PunchSource,
  PunchStatus,
  RiskReason,
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
