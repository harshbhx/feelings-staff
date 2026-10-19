/** Owner and manager schemas (PRD 4.12-4.17, 5.2, 9.4 "Owner and manager"). */
import { z } from 'zod';
import { Segment } from '../engine';
import {
  ActionType,
  AdjustmentKind,
  AuditCategory,
  AwayReason,
  ConsentKind,
  DayStatus,
  DayTag,
  DayType,
  Divisor,
  ExportFormat,
  ExportKind,
  ExportStatus,
  LeaveCode,
  OffsiteMode,
  OverrideStatus,
  PayMode,
  PayrollRunStatus,
  PdfStatus,
  Permission,
  PunchKind,
  RollCallSlotStatus,
  SalaryType,
  SetupStep,
  UserStatus,
  WorkedOffDayComp,
} from '../enums';
import {
  Cursor,
  Email,
  EpochMs,
  HalfDays,
  HHMM,
  Id,
  IsoWeek,
  Lat,
  Lng,
  Minutes,
  Note,
  OwnerPin,
  Paise,
  PersonBrief,
  PhoneE164,
  PhoneInput,
  PositivePaise,
  paginated,
  Reason,
  WorkDate,
  YearMonth,
} from '../primitives';
import { OrgSettings, OrgSettingsPatch, OtRate, SetupProgress } from '../settings';
import { PayslipView } from './staff';
import {
  AdvanceView,
  AuditEntryView,
  ConsentView,
  DayPayLine,
  DaySummary,
  DeviceView,
  DutyView,
  LeaveBalance,
  LeaveRequestView,
  MonthTotals,
  OwnerPunchView,
  RegularisationView,
  ScheduleView,
  ShiftTemplateView,
  SiteView,
} from './views';

// ---- Today board ---------------------------------------------------------------

export const PlaceBadge = z.enum(['inside', 'edge', 'venue', 'offline', 'owner']);

export const BoardInRow = z.object({
  user: PersonBrief,
  inTs: EpochMs,
  outTs: EpochMs.nullable(),
  lateMin: Minutes,
  place: PlaceBadge,
  placeName: z.string().nullable(),
  workedMin: Minutes,
  flagged: z.boolean(),
  pending: z.boolean(),
});
export type BoardInRow = z.infer<typeof BoardInRow>;

export const BoardNotInRow = z.object({
  user: PersonBrief,
  shiftStart: HHMM.nullable(),
  state: z.enum(['not_in_yet', 'due_later']),
  minutesLate: Minutes,
});
export type BoardNotInRow = z.infer<typeof BoardNotInRow>;

export const BoardAwayRow = z.object({
  user: PersonBrief,
  reason: z.enum(['leave', 'week_off', 'holiday']),
  leaveCode: LeaveCode.nullable(),
});

export const TodayBoard = z.object({
  date: WorkDate,
  updatedAt: EpochMs,
  /** Whole salon closed today (holiday), else null. */
  closed: z.object({ holidayName: z.string() }).nullable(),
  firstShiftStart: HHMM.nullable(),
  counters: z.object({
    present: z.number().int(),
    late: z.number().int(),
    notInYet: z.number().int(),
    onLeave: z.number().int(),
    weekOff: z.number().int(),
    atVenue: z.number().int(),
    checkedOut: z.number().int(),
  }),
  in: z.array(BoardInRow),
  notIn: z.array(BoardNotInRow),
  out: z.array(BoardInRow),
  away: z.array(BoardAwayRow),
  /** The roll-call slot worth showing now (open, or missed), else null (PRD 4.18.3, 9.4). */
  rollCall: z.object({ id: Id, slotTime: HHMM, status: RollCallSlotStatus }).nullable(),
  actionsCount: z.number().int(),
});
export type TodayBoard = z.infer<typeof TodayBoard>;

// ---- Needs action ------------------------------------------------------------------

const ActionBase = z.object({ id: z.string(), createdAt: EpochMs, user: PersonBrief });

const MapEvidence = z.object({
  lat: Lat.nullable(),
  lng: Lng.nullable(),
  accuracyM: z.number().nullable(),
  distanceM: z.number().int().nullable(),
  site: SiteView.nullable(),
});

export const ActionItem = z.discriminatedUnion('type', [
  ActionBase.extend({ type: z.literal('flagged_punch'), punch: OwnerPunchView, map: MapEvidence }),
  ActionBase.extend({ type: z.literal('pending_punch'), punch: OwnerPunchView, map: MapEvidence }),
  ActionBase.extend({
    type: z.literal('new_device'),
    device: DeviceView,
    replacesDeviceLabel: z.string().nullable(),
  }),
  ActionBase.extend({
    type: z.literal('leave_request'),
    request: LeaveRequestView,
    balanceAfter: HalfDays,
  }),
  ActionBase.extend({ type: z.literal('regularisation'), request: RegularisationView }),
  ActionBase.extend({
    type: z.literal('overtime'),
    workDate: WorkDate,
    candidateMin: Minutes,
    preapprovedMin: Minutes,
    punches: z.array(OwnerPunchView),
    shiftEnd: HHMM.nullable(),
  }),
  ActionBase.extend({
    type: z.literal('offsite_request'),
    punch: OwnerPunchView,
    map: MapEvidence,
  }),
  ActionBase.extend({
    type: z.literal('auto_closed'),
    workDate: WorkDate,
    autoOutTs: EpochMs,
    inTs: EpochMs,
  }),
  ActionBase.extend({
    type: z.literal('advance_request'),
    advance: AdvanceView,
    openBalancePaise: Paise,
  }),
  /** A closed step-out waiting for Confirm, Mark as work or Ignore (PRD 4.18.5). */
  ActionBase.extend({
    type: z.literal('away'),
    userId: Id,
    workDate: WorkDate,
    startTs: EpochMs,
    endTs: EpochMs,
    minutes: Minutes,
    reason: AwayReason.nullable(),
    staffNote: z.string().nullable().optional(),
    backMissing: z.boolean(),
  }),
]);
export type ActionItem = z.infer<typeof ActionItem>;

export const ActionsQuery = z.object({ type: ActionType.optional() });
export const ActionsView = z.object({
  items: z.array(ActionItem),
  counts: z.record(ActionType, z.number().int()),
});
export type ActionsView = z.infer<typeof ActionsView>;

export const PunchReviewRequest = z.object({
  decision: z.enum(['clear', 'approve', 'reject']),
  note: Note.optional(),
});
export const DecideRequest = z.object({
  decision: z.enum(['approve', 'reject']),
  note: Note.optional(),
});
export const RegularisationDecideRequest = DecideRequest.extend({
  adjustedTimes: z.object({ inTs: EpochMs.optional(), outTs: EpochMs.optional() }).optional(),
});
export const OvertimeParams = z.object({ userId: Id, date: WorkDate });
export const OvertimeDecideRequest = z.object({
  /** 0 = reject; otherwise a multiple of the overtime block. */
  approvedMin: z.number().int().min(0),
  note: Note.optional(),
});
export const AutoCloseDecideRequest = z.union([
  z.object({ keep: z.literal(true) }),
  z.object({ outTs: EpochMs }),
  /** Use the start of the open away interval as the check-out time (PRD 4.18.6). */
  z.object({ useAwayStart: z.literal(true) }),
]);
export const OffsiteDecideRequest = z.object({
  decision: z.enum(['approve', 'approve_and_open', 'reject']),
  staffIds: z.array(Id).optional(),
  note: Note.optional(),
});
export const BulkDecideRequest = z.object({
  type: z.enum([
    'flagged_punch',
    'pending_punch',
    'leave_request',
    'regularisation',
    'overtime',
    'auto_closed',
  ]),
  ids: z.array(z.string()).min(1).max(100),
  decision: z.enum(['approve', 'clear']),
});
export const BulkDecideResult = z.object({
  done: z.array(z.string()),
  failed: z.array(z.object({ id: z.string(), code: z.string() })),
});

// ---- Register and day detail ------------------------------------------------------

export const RegisterQuery = z.object({ month: YearMonth, userId: Id.optional() });

export const RegisterCell = z.object({
  status: DayStatus,
  dayType: DayType,
  tags: z.array(DayTag),
  leaveCode: LeaveCode.nullable(),
  lateMin: Minutes,
  inTs: EpochMs.nullable(),
  outTs: EpochMs.nullable(),
  /** Future dates have no data yet. */
  future: z.boolean(),
});
export type RegisterCell = z.infer<typeof RegisterCell>;

export const RegisterRow = z.object({
  user: PersonBrief,
  cells: z.array(RegisterCell),
  totals: MonthTotals,
});

export const RegisterView = z.object({
  month: YearMonth,
  dates: z.array(WorkDate),
  rows: z.array(RegisterRow),
  locked: z.boolean(),
});
export type RegisterView = z.infer<typeof RegisterView>;

export const UserDateParams = z.object({ userId: Id, date: WorkDate });

export const OwnerDayDetail = z.object({
  user: PersonBrief,
  day: DaySummary,
  schedule: ScheduleView,
  punches: z.array(OwnerPunchView),
  site: SiteView.nullable(),
  duty: DutyView.nullable(),
  lines: z.array(DayPayLine),
  enrolledPhotoUrl: z.string().nullable(),
  audit: z.array(AuditEntryView),
  locked: z.boolean(),
});
export type OwnerDayDetail = z.infer<typeof OwnerDayDetail>;

export const PunchEdit = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add'), kind: PunchKind, ts: EpochMs }),
  z.object({ op: z.literal('edit'), punchId: Id, ts: EpochMs }),
  z.object({ op: z.literal('delete'), punchId: Id }),
]);
export type PunchEdit = z.infer<typeof PunchEdit>;

export const DayOverrideRequest = z.object({
  status: OverrideStatus.optional(),
  leaveCode: LeaveCode.optional(),
  punches: z.array(PunchEdit).optional(),
  reason: Reason,
});
export type DayOverrideRequest = z.infer<typeof DayOverrideRequest>;

// ---- Staff ---------------------------------------------------------------------------

export const StaffListQuery = z.object({
  status: z.enum(['active', 'invited', 'exited', 'all']).optional(),
  q: z.string().max(80).optional(),
});

export const StaffRow = z.object({
  id: Id,
  name: z.string(),
  phone: PhoneE164.nullable(),
  designation: z.string(),
  status: UserStatus,
  deviceState: z.enum(['none', 'pending', 'approved']),
  joinDate: WorkDate,
  exitDate: WorkDate.nullable(),
  employeeCode: z.string().nullable(),
});
export type StaffRow = z.infer<typeof StaffRow>;

export const SalaryView = z.object({
  type: SalaryType,
  amountPaise: Paise,
  effectiveFrom: WorkDate,
  createdAt: EpochMs,
});

export const InviteView = z.object({
  url: z.string(),
  /** Formatted `XXX-XXXXX`. Shown once; only its HMAC is stored. */
  code: z.string(),
  message: z.string(),
  waLink: z.string(),
  expiresAt: EpochMs,
  purpose: z.enum(['join', 'pin_reset']),
});
export type InviteView = z.infer<typeof InviteView>;

export const StaffDetail = StaffRow.extend({
  lang: z.enum(['en', 'gu']),
  salary: SalaryView,
  salaryHistory: z.array(SalaryView),
  defaultTemplateId: Id,
  weekOffDow: z.number().int().min(0).max(6).nullable(),
  selfieRequired: z.boolean().nullable(),
  strongMode: z.boolean(),
  divisorOverride: Divisor.nullable(),
  otRateOverride: OtRate.nullable(),
  devices: z.array(DeviceView),
  leaveBalances: z.array(LeaveBalance),
  advanceBalancePaise: Paise,
  invite: z
    .object({ status: z.enum(['active', 'expired', 'used']), expiresAt: EpochMs })
    .nullable(),
  today: DaySummary.nullable(),
  monthTotals: MonthTotals,
  consents: z.array(ConsentView),
  exitReason: z.string().nullable(),
  minimumWageWarning: z.string().nullable(),
});
export type StaffDetail = z.infer<typeof StaffDetail>;

export const StaffCreate = z.object({
  name: z.string().trim().min(1).max(80),
  phone: PhoneInput,
  designation: z.string().trim().min(1).max(40),
  joinDate: WorkDate,
  salaryType: SalaryType,
  salaryAmountPaise: PositivePaise,
  defaultTemplateId: Id,
  weekOffDow: z.number().int().min(0).max(6).nullable(),
  lang: z.enum(['en', 'gu']),
  selfieRequired: z.boolean().nullable(),
  employeeCode: z.string().trim().max(20).optional(),
  /** The owner confirms the person is 18 or older (PRD 10.6). */
  adultConfirmed: z.literal(true),
});
export type StaffCreate = z.infer<typeof StaffCreate>;

export const StaffCreated = z.object({ staff: StaffDetail, invite: InviteView });

export const StaffPatch = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  phone: PhoneInput.optional(),
  designation: z.string().trim().min(1).max(40).optional(),
  defaultTemplateId: Id.optional(),
  weekOffDow: z.number().int().min(0).max(6).nullable().optional(),
  lang: z.enum(['en', 'gu']).optional(),
  selfieRequired: z.boolean().nullable().optional(),
  strongMode: z.boolean().optional(),
  divisorOverride: Divisor.nullable().optional(),
  otRateOverride: OtRate.nullable().optional(),
  employeeCode: z.string().trim().max(20).nullable().optional(),
  /** Effective-dated salary change; needs step-up. */
  salary: z
    .object({ type: SalaryType, amountPaise: PositivePaise, effectiveFrom: WorkDate })
    .optional(),
});
export type StaffPatch = z.infer<typeof StaffPatch>;

export const StaffExitRequest = z.object({ lastDay: WorkDate, reason: Reason });
export const StaffRehireRequest = z.object({ joinDate: WorkDate });
export const StaffInviteResult = z.object({ invite: InviteView });

export const LeaveLedgerRow = z.object({
  id: Id,
  code: LeaveCode,
  entryDate: WorkDate,
  kind: z.enum(['credit', 'debit', 'expire', 'adjust']),
  days: HalfDays,
  note: z.string().nullable(),
  expiresOn: WorkDate.nullable(),
  createdAt: EpochMs,
});
export const StaffLeaveView = z.object({
  balances: z.array(LeaveBalance),
  ledger: z.array(LeaveLedgerRow),
  requests: z.array(LeaveRequestView),
});
export const LeaveAdjustRequest = z.object({
  code: LeaveCode,
  days: HalfDays.refine((d) => d !== 0, 'Must not be zero'),
  note: Reason,
});

// ---- Roster, templates, holidays ------------------------------------------------------

export const RosterQuery = z.object({ week: IsoWeek });
export const RosterCell = z.object({
  date: WorkDate,
  kind: z.enum(['template', 'WO', 'HO', 'L', 'NE', 'no_shift']),
  templateId: Id.nullable(),
  templateName: z.string().nullable(),
  segments: z.array(Segment),
  override: z.boolean(),
  leaveCode: LeaveCode.nullable(),
  duties: z.array(z.object({ id: Id, placeName: z.string(), startTs: EpochMs, endTs: EpochMs })),
});
export type RosterCell = z.infer<typeof RosterCell>;
export const RosterView = z.object({
  week: IsoWeek,
  dates: z.array(WorkDate).length(7),
  rows: z.array(
    z.object({
      user: PersonBrief,
      cells: z.array(RosterCell).length(7),
      scheduledMin: Minutes,
      over48: z.boolean(),
    }),
  ),
  templates: z.array(ShiftTemplateView),
});
export type RosterView = z.infer<typeof RosterView>;
export const RosterChange = z.object({
  userId: Id,
  date: WorkDate,
  kind: z.enum(['template', 'week_off', 'no_shift', 'clear']),
  templateId: Id.optional(),
  note: Note.optional(),
});
export type RosterChange = z.infer<typeof RosterChange>;
export const RosterPut = z.object({ changes: z.array(RosterChange).min(1).max(100) });

export const ShiftTemplateCreate = z.object({
  name: z.string().trim().min(1).max(40),
  segments: z.array(Segment).min(1).max(3),
  breakMin: z.number().int().min(0).max(180),
});
export const ShiftTemplatePatch = ShiftTemplateCreate.partial().extend({
  active: z.boolean().optional(),
  sort: z.number().int().optional(),
});

export const HolidaysQuery = z.object({ year: z.coerce.number().int().min(2020).max(2100) });
export const HolidayCreate = z.object({
  date: WorkDate,
  name: z.string().trim().min(1).max(60),
  paid: z.boolean(),
  workedComp: WorkedOffDayComp,
});
export const HolidayPatch = HolidayCreate.partial();
export const BlackoutDay = z.object({ date: WorkDate, note: z.string().nullable() });
export const BlackoutCreate = z.object({ date: WorkDate, note: Note.optional() });
export const DateKeyParams = z.object({ date: WorkDate });

// ---- Sites, calibration, door ---------------------------------------------------------

export const SitePatch = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  lat: Lat.optional(),
  lng: Lng.optional(),
  radiusM: z.number().int().min(50).max(300).multipleOf(25).optional(),
  maxAccuracyM: z.number().int().min(30).max(100).optional(),
});
export const CalibrationSamples = z.object({
  sessionId: z.string().min(8).max(40),
  platform: z.enum(['android', 'ios', 'desktop', 'other']),
  samples: z
    .array(z.object({ lat: Lat, lng: Lng, accuracyM: z.number().nonnegative(), takenAt: EpochMs }))
    .min(1)
    .max(200),
});
export const CalibrationProposal = z.object({
  centre: z.object({ lat: Lat, lng: Lng }),
  radiusM: z.number().int(),
  stats: z.object({
    sessions: z.number().int(),
    samples: z.number().int(),
    p95DistanceM: z.number(),
    medianAccuracyM: z.number(),
  }),
  enoughData: z.boolean(),
});

export const DoorCode = z.object({
  url: z.string(),
  token: z.string().length(10),
  step: z.number().int(),
  expiresAt: EpochMs,
  siteId: Id,
  siteName: z.string(),
});
export type DoorCode = z.infer<typeof DoorCode>;
export const DoorDeviceView = z.object({
  id: Id,
  label: z.string(),
  siteId: Id,
  status: z.enum(['pairing', 'active', 'revoked']),
  pairedAt: EpochMs.nullable(),
  lastSeenAt: EpochMs.nullable(),
});
export const DoorDeviceCreate = z.object({
  label: z.string().trim().min(1).max(40),
  siteId: Id.optional(),
});
export const DoorPairing = z.object({
  doorDeviceId: Id,
  pairingCode: z.string(),
  expiresAt: EpochMs,
});

// ---- Off-site duties -----------------------------------------------------------------

export const DutiesQuery = z.object({ from: WorkDate, to: WorkDate });
export const DutyCreate = z.object({
  userIds: z.array(Id).min(1),
  workDate: WorkDate,
  startTs: EpochMs,
  endTs: EpochMs,
  placeName: z.string().trim().min(1).max(120),
  location: z.object({ lat: Lat, lng: Lng }).nullable(),
  radiusM: z.number().int().min(100).max(500),
  mode: OffsiteMode,
  otPreapproved: z.boolean(),
  note: Note.optional(),
});
export type DutyCreate = z.infer<typeof DutyCreate>;
export const DutyPatch = DutyCreate.partial();
export const MapsResolveRequest = z.object({ url: z.url().max(2000) });
export const MapsResolveResult = z.object({ lat: Lat, lng: Lng, label: z.string().optional() });

// ---- Advances (owner) -----------------------------------------------------------------

export const AdvancesQuery = z.object({
  userId: Id.optional(),
  status: z.enum(['open', 'all']).optional(),
});
export const AdvanceCreate = z.object({
  userId: Id,
  amountPaise: PositivePaise,
  givenOn: WorkDate,
  mode: PayMode,
  reason: z.string().trim().max(300).optional(),
  plan: z.enum(['full', 'instalments']),
  instalmentsN: z.number().int().min(2).max(12).optional(),
  firstMonth: YearMonth,
  askStaffAck: z.boolean(),
});
export type AdvanceCreate = z.infer<typeof AdvanceCreate>;
export const AdvancePatch = AdvanceCreate.omit({ userId: true, askStaffAck: true }).partial();
export const AdvanceDecideRequest = DecideRequest.extend({
  givenOn: WorkDate.optional(),
  mode: PayMode.optional(),
});
export const AdvancesView = z.object({
  items: z.array(AdvanceView),
  balances: z.array(z.object({ user: PersonBrief, balancePaise: Paise })),
});

// ---- Payroll ----------------------------------------------------------------------------

export const PayrollRunSummary = z.object({
  id: Id,
  month: YearMonth,
  revision: z.number().int(),
  status: PayrollRunStatus,
  people: z.number().int(),
  netPaise: Paise,
  paidCount: z.number().int(),
  createdAt: EpochMs,
  finalisedAt: EpochMs.nullable(),
});
export type PayrollRunSummary = z.infer<typeof PayrollRunSummary>;

export const PayrollBlocker = z.object({
  kind: z.enum([
    'pending_punches',
    'flagged_punches',
    'overtime_undecided',
    'leave_undecided',
    'regularisations_undecided',
    'open_sessions',
  ]),
  count: z.number().int(),
  /** What happens if the owner finalises anyway (PRD 4.13.2). */
  defaultAction: z.string(),
  items: z.array(z.object({ user: PersonBrief, workDate: WorkDate.nullable(), refId: z.string() })),
});
export type PayrollBlocker = z.infer<typeof PayrollBlocker>;

export const PayrollPersonLine = z.object({
  user: PersonBrief,
  payslipId: Id.nullable(),
  salaryType: SalaryType,
  paidDays: HalfDays,
  lopDays: HalfDays,
  lateMin: Minutes,
  earlyMin: Minutes,
  otApprovedMin: Minutes,
  grossPaise: Paise,
  deductionsPaise: Paise,
  netPaise: Paise,
  warnings: z.array(z.string()),
  paid: z.object({ on: WorkDate, mode: PayMode, ref: z.string().nullable() }).nullable(),
  pdfStatus: PdfStatus.nullable(),
});
export type PayrollPersonLine = z.infer<typeof PayrollPersonLine>;

export const PayrollRunView = z.object({
  run: PayrollRunSummary.extend({
    finalisedByName: z.string().nullable(),
    reopenedReason: z.string().nullable(),
    engineVersion: z.string(),
    preview: z.boolean(),
  }),
  blockers: z.array(PayrollBlocker),
  totals: z.object({
    people: z.number().int(),
    grossPaise: Paise,
    deductionsPaise: Paise,
    netPaise: Paise,
    paidCount: z.number().int(),
  }),
  lines: z.array(PayrollPersonLine),
  warnings: z.array(z.string()),
});
export type PayrollRunView = z.infer<typeof PayrollRunView>;

export const PayrollCreate = z.object({ month: YearMonth });
export const PayrollPreviewQuery = z.object({ month: YearMonth });
export const RunPersonParams = z.object({ id: Id, userId: Id });
export const RunAdjParams = z.object({ id: Id, adjId: Id });
export const AdjustmentCreate = z.object({
  userId: Id,
  kind: AdjustmentKind,
  amountPaise: PositivePaise,
  note: Reason,
  showCauseRef: z.string().max(80).optional(),
});
export type AdjustmentCreate = z.infer<typeof AdjustmentCreate>;
export const AdvanceRecoveryPatch = z.object({
  userId: Id,
  advanceId: Id,
  recoverPaise: Paise.nonnegative(),
});
export const FinaliseRequest = z.object({ acceptDefaults: z.boolean() });
export const ReopenRequest = z.object({
  reason: Reason,
  settleMode: z.enum(['next_month', 'reissue']),
});
export const MarkPaidRequest = z.object({
  paidOn: WorkDate,
  mode: PayMode,
  ref: z.string().max(80).optional(),
});
export const OwnerPayslipView = PayslipView.extend({
  adjustments: z.array(
    z.object({
      id: Id,
      kind: AdjustmentKind,
      amountPaise: Paise,
      note: z.string(),
      createdAt: EpochMs,
    }),
  ),
  advances: z.array(
    z.object({ advanceId: Id, duePaise: Paise, recoverPaise: Paise, balancePaise: Paise }),
  ),
  shareText: z.string(),
  waLink: z.string().nullable(),
});
export type OwnerPayslipView = z.infer<typeof OwnerPayslipView>;

// ---- Exports ------------------------------------------------------------------------------

export const ExportRequest = z.object({
  kind: ExportKind,
  month: YearMonth,
  format: ExportFormat,
  userIds: z.array(Id).optional(),
});
export type ExportRequest = z.infer<typeof ExportRequest>;
export const ExportCreated = z.object({ exportId: Id });
export const ExportView = z.object({
  id: Id,
  kind: ExportKind,
  format: ExportFormat,
  month: YearMonth,
  status: ExportStatus,
  createdAt: EpochMs,
  expiresAt: EpochMs,
  fileUrl: z.string().nullable(),
  fileName: z.string(),
});
export type ExportView = z.infer<typeof ExportView>;

// ---- Settings, setup, security, audit, managers ------------------------------------------

export const OrgProfile = z.object({
  name: z.string(),
  address: z.string().nullable(),
  phone: PhoneE164.nullable(),
  ownerDisplayName: z.string(),
  logo: z.enum(['bindi', 'wordmark']),
});
export const SettingsView = z.object({
  org: OrgProfile,
  settings: OrgSettings,
  settingsVersion: z.number().int(),
  minAppVersion: z.string(),
  updatedAt: EpochMs,
});
export type SettingsView = z.infer<typeof SettingsView>;
export const SettingsPatchRequest = z.object({
  org: z
    .object({
      name: z.string().trim().min(1).max(120),
      address: z.string().trim().max(240).nullable(),
      phone: PhoneInput.nullable(),
      ownerDisplayName: z.string().trim().min(1).max(40),
      logo: z.enum(['bindi', 'wordmark']),
    })
    .partial()
    .optional(),
  settings: OrgSettingsPatch.optional(),
});

export const SetupView = z.object({ steps: SetupProgress, complete: z.boolean() });
export const SetupStepParams = z.object({ step: SetupStep });
export const SetupStepRequest = z.object({ state: z.enum(['done', 'skipped', 'todo']) });

export const SecurityView = z.object({
  email: Email,
  passwordSet: z.boolean(),
  pinSet: z.boolean(),
  sessions: z.array(
    z.object({
      id: z.string(),
      current: z.boolean(),
      createdAt: EpochMs,
      lastSeenAt: EpochMs,
      label: z.string(),
    }),
  ),
});
export const SetPasswordRequest = z.object({
  password: z.string().min(10).max(200),
  pin: OwnerPin,
});
export const SetPinRequest = z.object({ pin: OwnerPin, currentPin: OwnerPin.optional() });

export const AuditQuery = z.object({
  entity: z.string().max(40).optional(),
  entityId: z.string().max(40).optional(),
  category: AuditCategory.optional(),
  from: WorkDate.optional(),
  to: WorkDate.optional(),
  cursor: Cursor.optional(),
});
export const AuditPage = paginated(AuditEntryView);

export const ManagerView = z.object({
  user: PersonBrief,
  permissions: z.array(Permission),
  staffIds: z.array(Id),
});
export const ManagerUpsert = z.object({
  userId: Id,
  permissions: z.array(Permission),
  staffIds: z.array(Id),
});

export const ConsentListForStaff = z.array(z.object({ kind: ConsentKind, acceptedAt: EpochMs }));

export const UserIdParams = z.object({ id: Id });
export const DeviceIdParams = z.object({ id: Id });
export const RevokeRequest = z.object({ reason: Reason });
export const DayPayLines = z.array(DayPayLine);
