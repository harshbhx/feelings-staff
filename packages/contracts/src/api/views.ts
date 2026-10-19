/** View models shared by staff and owner screens. */
import { z } from 'zod';
import { Segment } from '../engine';
import {
  AdvanceAck,
  AdvancePlan,
  AdvanceStatus,
  AuditActorType,
  AuditCategory,
  ConsentKind,
  DayStatus,
  DayTag,
  DayType,
  DeviceStatus,
  DistanceBucket,
  FenceResult,
  HalfDayPart,
  LeaveCode,
  OffsiteMode,
  OtStatus,
  PayMode,
  PendingReason,
  Platform,
  PunchKind,
  PunchSource,
  PunchStatus,
  RegularisationKind,
  RequestStatus,
  RiskReason,
  SiteKind,
  WorkedOffDayComp,
} from '../enums';
import {
  EpochMs,
  HalfDays,
  HHMM,
  Id,
  Lat,
  Lng,
  Minutes,
  Paise,
  PersonBrief,
  WorkDate,
  YearMonth,
} from '../primitives';

export const SiteView = z.object({
  id: Id,
  kind: SiteKind,
  name: z.string(),
  lat: Lat,
  lng: Lng,
  radiusM: z.number().int(),
  maxAccuracyM: z.number().int(),
  active: z.boolean(),
  validFrom: EpochMs.nullable(),
  validTo: EpochMs.nullable(),
});
export type SiteView = z.infer<typeof SiteView>;

/** A punch as the staff member sees it. */
export const PunchView = z.object({
  id: Id,
  kind: PunchKind,
  /** Time used for pay (server time of the first submission, or the owner's correction). */
  effectiveTs: EpochMs,
  serverTs: EpochMs,
  workDate: WorkDate,
  source: PunchSource,
  status: PunchStatus,
  pendingReason: PendingReason.nullable(),
  siteName: z.string().nullable(),
  placeName: z.string().nullable(),
  fenceResult: FenceResult.nullable(),
  distanceBucket: DistanceBucket.nullable(),
  riskReasons: z.array(RiskReason),
  offsiteDutyId: Id.nullable(),
  /** "edited by Urmi": the punch was created or replaced by the owner. */
  edited: z.boolean(),
  note: z.string().nullable(),
  reviewNote: z.string().nullable(),
});
export type PunchView = z.infer<typeof PunchView>;

/** A punch with the evidence the owner sees (PRD 4.12, 5.2 day detail). */
export const OwnerPunchView = PunchView.extend({
  lat: Lat.nullable(),
  lng: Lng.nullable(),
  accuracyM: z.number().nullable(),
  distanceM: z.number().int().nullable(),
  samplesN: z.number().int().nullable(),
  riskScore: z.number().int(),
  qrVerified: z.boolean(),
  pinVerified: z.boolean(),
  sigVerified: z.boolean(),
  /** Session-checked URL for the selfie thumbnail, null if none or deleted. */
  selfieUrl: z.string().nullable(),
  selfieDeletedAt: EpochMs.nullable(),
  deviceLabel: z.string().nullable(),
  ipCountry: z.string().nullable(),
  clientTs: EpochMs.nullable(),
  reviewedByName: z.string().nullable(),
  reviewedAt: EpochMs.nullable(),
});
export type OwnerPunchView = z.infer<typeof OwnerPunchView>;

/** One person-day, as stored in attendance_days. */
export const DaySummary = z.object({
  workDate: WorkDate,
  dayType: DayType,
  status: DayStatus,
  leaveCode: LeaveCode.nullable(),
  templateName: z.string().nullable(),
  scheduledMin: Minutes,
  workedMin: Minutes,
  lateMin: Minutes,
  lateBillableMin: Minutes,
  earlyMin: Minutes,
  earlyBillableMin: Minutes,
  undertimeMin: Minutes,
  otPreapprovedMin: Minutes,
  otCandidateMin: Minutes,
  otApprovedMin: Minutes,
  otStatus: OtStatus,
  offdayCredit: z.number(),
  tags: z.array(DayTag),
  firstInTs: EpochMs.nullable(),
  lastOutTs: EpochMs.nullable(),
  locked: z.boolean(),
  holidayName: z.string().nullable(),
});
export type DaySummary = z.infer<typeof DaySummary>;

export const MonthTotals = z.object({
  present: z.number().int(),
  half: z.number().int(),
  absent: z.number().int(),
  leave: HalfDays,
  lop: HalfDays,
  weekOff: z.number().int(),
  holiday: z.number().int(),
  workedMin: Minutes,
  lateMin: Minutes,
  lateBillableMin: Minutes,
  earlyBillableMin: Minutes,
  otApprovedMin: Minutes,
  otPendingMin: Minutes,
});
export type MonthTotals = z.infer<typeof MonthTotals>;

/** The schedule for a day, in wall-clock terms. */
export const ScheduleView = z.object({
  dayType: DayType,
  templateId: Id.nullable(),
  templateName: z.string().nullable(),
  segments: z.array(Segment),
  breakMin: z.number().int(),
  scheduledMin: Minutes,
  startTs: EpochMs.nullable(),
  endTs: EpochMs.nullable(),
  holidayName: z.string().nullable(),
  leave: z.object({ code: LeaveCode, name: z.string(), half: HalfDayPart }).nullable(),
  nightHours: z.boolean(),
});
export type ScheduleView = z.infer<typeof ScheduleView>;

/** A line explaining the pay effect of a day ("-Rs 13.44 for 15 min late"). */
export const DayPayLine = z.object({
  code: z.enum([
    'late',
    'early',
    'undertime',
    'overtime',
    'lop',
    'half_day',
    'offday_extra',
    'comp_off',
    'info',
  ]),
  label: z.string(),
  formula: z.string(),
  amountPaise: Paise.nullable(),
});
export type DayPayLine = z.infer<typeof DayPayLine>;

export const AuditEntryView = z.object({
  id: Id,
  category: AuditCategory,
  actorType: AuditActorType,
  actorId: z.string().nullable(),
  actorName: z.string().nullable(),
  action: z.string(),
  entity: z.string(),
  entityId: z.string().nullable(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  reason: z.string().nullable(),
  createdAt: EpochMs,
});
export type AuditEntryView = z.infer<typeof AuditEntryView>;

export const DutyView = z.object({
  id: Id,
  workDate: WorkDate,
  startTs: EpochMs,
  endTs: EpochMs,
  mode: OffsiteMode,
  otPreapproved: z.boolean(),
  placeName: z.string(),
  note: z.string().nullable(),
  site: z.object({ id: Id, lat: Lat, lng: Lng, radiusM: z.number().int() }).nullable(),
  staff: z.array(PersonBrief),
  nightHours: z.boolean(),
  cancelledAt: EpochMs.nullable(),
  createdAt: EpochMs,
});
export type DutyView = z.infer<typeof DutyView>;

export const LeaveBalance = z.object({
  code: LeaveCode,
  name: z.string(),
  paid: z.boolean(),
  balance: HalfDays,
  /** Days in pending requests, not yet debited. */
  pending: HalfDays,
  /** Comp-off: the next expiry, if any. */
  nextExpiry: z.object({ days: HalfDays, on: WorkDate }).nullable(),
  usableFrom: WorkDate.nullable(),
});
export type LeaveBalance = z.infer<typeof LeaveBalance>;

export const LeaveRequestView = z.object({
  id: Id,
  user: PersonBrief,
  typeCode: LeaveCode,
  typeName: z.string(),
  fromDate: WorkDate,
  toDate: WorkDate,
  half: HalfDayPart,
  daysPaid: HalfDays,
  daysUnpaid: HalfDays,
  reason: z.string().nullable(),
  blackoutHit: z.boolean(),
  status: RequestStatus,
  decidedAt: EpochMs.nullable(),
  decidedByName: z.string().nullable(),
  decisionNote: z.string().nullable(),
  cancelledAt: EpochMs.nullable(),
  createdAt: EpochMs,
});
export type LeaveRequestView = z.infer<typeof LeaveRequestView>;

export const RegularisationView = z.object({
  id: Id,
  user: PersonBrief,
  workDate: WorkDate,
  kind: RegularisationKind,
  targetPunchId: Id.nullable(),
  proposedInTs: EpochMs.nullable(),
  proposedOutTs: EpochMs.nullable(),
  /** What is recorded today, for "old vs proposed". */
  currentInTs: EpochMs.nullable(),
  currentOutTs: EpochMs.nullable(),
  placeName: z.string().nullable(),
  reason: z.string(),
  status: RequestStatus,
  decidedAt: EpochMs.nullable(),
  decidedByName: z.string().nullable(),
  decisionNote: z.string().nullable(),
  createdAt: EpochMs,
});
export type RegularisationView = z.infer<typeof RegularisationView>;

export const AdvanceLedgerRow = z.object({
  month: YearMonth,
  scheduledPaise: Paise,
  recoveredPaise: Paise,
  carriedPaise: Paise,
  payrollRunId: Id,
});

export const AdvanceView = z.object({
  id: Id,
  user: PersonBrief,
  amountPaise: Paise,
  givenOn: WorkDate.nullable(),
  mode: PayMode.nullable(),
  reason: z.string().nullable(),
  plan: AdvancePlan,
  instalmentsN: z.number().int().nullable(),
  firstMonth: YearMonth,
  status: AdvanceStatus,
  staffAck: AdvanceAck,
  staffAckAt: EpochMs.nullable(),
  recoveredPaise: Paise,
  balancePaise: Paise,
  ledger: z.array(AdvanceLedgerRow),
  createdAt: EpochMs,
});
export type AdvanceView = z.infer<typeof AdvanceView>;

export const DeviceView = z.object({
  id: Id,
  userId: Id,
  label: z.string(),
  platform: Platform,
  status: DeviceStatus,
  requestedAt: EpochMs,
  approvedAt: EpochMs.nullable(),
  lastSeenAt: EpochMs.nullable(),
});
export type DeviceView = z.infer<typeof DeviceView>;

export const ConsentView = z.object({
  kind: ConsentKind,
  version: z.string(),
  lang: z.string(),
  acceptedAt: EpochMs,
  withdrawnAt: EpochMs.nullable(),
});
export type ConsentView = z.infer<typeof ConsentView>;

export const HolidayView = z.object({
  id: Id,
  date: WorkDate,
  name: z.string(),
  paid: z.boolean(),
  workedComp: WorkedOffDayComp,
});
export type HolidayView = z.infer<typeof HolidayView>;

export const ShiftTemplateView = z.object({
  id: Id,
  name: z.string(),
  segments: z.array(Segment).min(1),
  breakMin: z.number().int().min(0).max(180),
  scheduledMin: Minutes,
  active: z.boolean(),
  sort: z.number().int(),
});
export type ShiftTemplateView = z.infer<typeof ShiftTemplateView>;

/** Wall-clock helper used by forms. */
export const TimeOfDay = HHMM;
