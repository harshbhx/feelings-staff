/** Staff-facing attendance, requests and pay schemas (PRD 4.3-4.11, 4.14, 5.1, 9.4). */
import { z } from 'zod';
import { Fix, PayslipResult } from '../engine';
import {
  ConsentKind,
  DistanceBucket,
  FenceResult,
  HalfDayPart,
  LeaveCode,
  PayMode,
  PdfStatus,
  PunchKind,
  PunchOutcome,
  RegularisationKind,
  RiskReason,
} from '../enums';
import {
  Base64Url,
  EpochMs,
  HalfDays,
  Id,
  Note,
  Paise,
  PositivePaise,
  Reason,
  WorkDate,
  YearMonth,
} from '../primitives';
import {
  AdvanceView,
  AuditEntryView,
  ConsentView,
  DayPayLine,
  DaySummary,
  DutyView,
  LeaveBalance,
  LeaveRequestView,
  MonthTotals,
  PunchView,
  RegularisationView,
  ScheduleView,
} from './views';

// ---- Nonces and signed time ------------------------------------------------

export const NonceRequest = z.object({ purpose: z.enum(['punch', 'offline']) });
export const PunchNonce = z.object({
  nonce: Base64Url,
  expiresAt: EpochMs,
  serverTime: EpochMs,
  timeSig: z.string(),
});
export const OfflineNonces = z.object({
  nonces: z.array(z.object({ nonce: Base64Url, expiresAt: EpochMs })).length(2),
  serverTime: EpochMs,
  timeSig: z.string(),
});
export const NonceResult = z.union([PunchNonce, OfflineNonces]);
export type NonceResult = z.infer<typeof NonceResult>;

// ---- Punch ------------------------------------------------------------------

export const OfflineProof = z.object({
  /** Last signed server time the app had, and its signature. */
  lastServerTime: EpochMs,
  timeSig: z.string(),
  /** performance.now() and Date.now() deltas between that anchor and the event. */
  perfDeltaMs: z.number().int(),
  wallDeltaMs: z.number().int(),
  /** RSA-OAEP-256 sealed `{ pin, idempotencyKey }`, base64url. Excluded from the signature. */
  pinEnvelope: Base64Url,
});
export type OfflineProof = z.infer<typeof OfflineProof>;

/**
 * The signed punch payload (PRD 9.4). The signature is ECDSA P-256/SHA-256 (IEEE P1363, base64url)
 * over the RFC 8785 canonical JSON of every field except `signature`, `pin` and
 * `offline.pinEnvelope` (see util/punch-canonical.ts).
 */
export const PunchRequest = z.object({
  v: z.literal(1),
  kind: PunchKind,
  nonce: Base64Url,
  deviceId: Id,
  clientTs: EpochMs,
  idempotencyKey: z.string().min(16).max(64),
  fix: Fix.nullable(),
  selfieSha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable(),
  qrToken: z.string().min(10).max(10).nullable(),
  offsiteDutyId: Id.nullable(),
  /** Unplanned venue ("I'm at a venue"). */
  placeName: z.string().trim().max(120).nullable(),
  deviceTz: z.string().max(64),
  offline: OfflineProof.nullable(),
  pin: z
    .string()
    .regex(/^\d{4,6}$/)
    .nullable(),
  clientDurationMs: z.number().int().nonnegative(),
  /** "Send to Urmi for approval": store as pending instead of rejecting (PRD 4.4.2). */
  requestApproval: z.boolean(),
  note: Note.nullable(),
  /** Confirmations the staff member gave ("check in anyway" on a week off, leave day). */
  ack: z.array(z.enum(['week_off', 'holiday', 'on_leave', 'too_early'])),
  appVersion: z.string().max(32),
  signature: Base64Url,
});
export type PunchRequest = z.infer<typeof PunchRequest>;

export const PunchResult = z.object({
  punch: PunchView,
  outcome: PunchOutcome,
  riskReasons: z.array(RiskReason),
  fence: z.object({
    result: FenceResult,
    distanceM: z.number().int().nullable(),
    bucket: DistanceBucket.nullable(),
  }),
  day: DaySummary,
  /** For check-out: stayed past shift end by 30+ min. */
  stayedAfterMin: z.number().int().nullable(),
  /** Pending punch can be upgraded with a door QR until this time. */
  proofUntil: EpochMs.nullable(),
});
export type PunchResult = z.infer<typeof PunchResult>;

export const PunchIdParams = z.object({ id: Id });
export const PunchProofRequest = z.object({
  qrToken: z.string().length(10),
  /** Signature over the canonical JSON `{ punchId, qrToken }`. */
  signature: Base64Url,
});
export const PunchApprovalRequest = z.object({
  note: Note,
  placeName: z.string().trim().max(120).nullable(),
});

// ---- Today, month, day -------------------------------------------------------

export const TodayView = z.object({
  date: WorkDate,
  serverTime: EpochMs,
  schedule: ScheduleView,
  state: z.enum(['out', 'in', 'on_break']),
  /** Current open session start (effective time), when in. */
  inSinceTs: EpochMs.nullable(),
  punches: z.array(PunchView),
  day: DaySummary.nullable(),
  duty: DutyView.nullable(),
  /** Earliest time a check-in is allowed without approval. */
  earliestCheckInTs: EpochMs.nullable(),
  /** Pending punches waiting for a QR or the owner. */
  pendingCount: z.number().int(),
});
export type TodayView = z.infer<typeof TodayView>;

export const MonthQuery = z.object({ month: YearMonth });
export const MonthView = z.object({
  month: YearMonth,
  days: z.array(DaySummary),
  totals: MonthTotals,
  duties: z.array(DutyView),
});
export type MonthView = z.infer<typeof MonthView>;

export const DateParams = z.object({ date: WorkDate });
export const DayDetail = z.object({
  day: DaySummary,
  schedule: ScheduleView,
  punches: z.array(PunchView),
  lines: z.array(DayPayLine),
  /** Owner edits that touched this day ("Edited by Urmi"). */
  edits: z.array(AuditEntryView),
  canRegularise: z.boolean(),
  openRegularisation: RegularisationView.nullable(),
});
export type DayDetail = z.infer<typeof DayDetail>;

// ---- Leave ------------------------------------------------------------------------

export const MyLeave = z.object({
  balances: z.array(LeaveBalance),
  requests: z.array(LeaveRequestView),
  blackoutDays: z.array(z.object({ date: WorkDate, note: z.string().nullable() })),
});
export type MyLeave = z.infer<typeof MyLeave>;

export const LeaveRequestCreate = z.object({
  typeCode: LeaveCode,
  fromDate: WorkDate,
  toDate: WorkDate,
  half: HalfDayPart.optional(),
  reason: z.string().trim().max(300).optional(),
  /** The staff member confirmed "the other N days will be unpaid". */
  acceptUnpaidSplit: z.boolean(),
});
export type LeaveRequestCreate = z.infer<typeof LeaveRequestCreate>;

export const LeaveWarning = z.object({
  code: z.enum([
    'notice',
    'balance',
    'blackout',
    'overlap',
    'locked',
    'usable_after',
    'backdate',
    'reason_required',
  ]),
  message: z.string(),
  blocking: z.boolean(),
});
export const LeavePreview = z.object({
  countedDays: HalfDays,
  excluded: z.array(z.object({ date: WorkDate, reason: z.enum(['week_off', 'holiday']) })),
  daysPaid: HalfDays,
  daysUnpaid: HalfDays,
  warnings: z.array(LeaveWarning),
});
export type LeavePreview = z.infer<typeof LeavePreview>;

export const IdParams = z.object({ id: Id });

// ---- Regularisation ---------------------------------------------------------------

export const RegularisationCreate = z.object({
  workDate: WorkDate,
  kind: RegularisationKind,
  targetPunchId: Id.optional(),
  proposedInTs: EpochMs.optional(),
  proposedOutTs: EpochMs.optional(),
  placeName: z.string().trim().max(120).optional(),
  reason: Reason,
});
export type RegularisationCreate = z.infer<typeof RegularisationCreate>;

// ---- Advances (staff side) -------------------------------------------------------

export const AdvanceRequestCreate = z.object({
  amountPaise: PositivePaise,
  reason: Reason,
  plan: z.enum(['full', 'instalments']),
  instalmentsN: z.number().int().min(2).max(12).optional(),
});
export const AdvanceAckRequest = z.object({
  answer: z.enum(['confirmed', 'disputed']),
  note: Note.optional(),
});

// ---- Payslips ----------------------------------------------------------------------

export const PayslipSummary = z.object({
  id: Id,
  month: YearMonth,
  netPaise: Paise,
  revision: z.number().int(),
  superseded: z.boolean(),
  paidOn: WorkDate.nullable(),
  payMode: PayMode.nullable(),
  pdfStatus: PdfStatus,
});
export type PayslipSummary = z.infer<typeof PayslipSummary>;

/** Display data around a PayslipResult (same template for screen and PDF; PRD 4.14). */
export const PayslipView = z.object({
  id: Id.nullable(),
  runId: Id,
  revision: z.number().int(),
  status: z.enum(['draft', 'final', 'superseded']),
  month: YearMonth,
  org: z.object({ name: z.string(), address: z.string().nullable() }),
  person: z.object({
    id: Id,
    name: z.string(),
    employeeCode: z.string().nullable(),
    designation: z.string().nullable(),
    joinDate: WorkDate,
  }),
  result: PayslipResult,
  paid: z.object({ on: WorkDate, mode: PayMode, ref: z.string().nullable() }).nullable(),
  pdfStatus: PdfStatus,
  /** Session-checked PDF URL when ready. */
  pdfUrl: z.string().nullable(),
  verifyUrl: z.string().nullable(),
  leaveBalances: z.array(z.object({ code: LeaveCode, name: z.string(), balance: HalfDays })),
  generatedAt: EpochMs,
});
export type PayslipView = z.infer<typeof PayslipView>;

// ---- My data (DPDP) -----------------------------------------------------------------

export const MyData = z.object({
  punches: z.array(
    z.object({
      id: Id,
      kind: PunchKind,
      effectiveTs: EpochMs,
      fenceResult: FenceResult.nullable(),
      distanceBucket: DistanceBucket.nullable(),
      placeName: z.string().nullable(),
      siteName: z.string().nullable(),
      locationKept: z.boolean(),
      locationDeletesOn: WorkDate.nullable(),
    }),
  ),
  selfies: z.array(
    z.object({ punchId: Id, takenAt: EpochMs, deletesOn: WorkDate, url: z.string() }),
  ),
  consents: z.array(ConsentView),
  retention: z.object({
    locationDays: z.number().int(),
    selfieDays: z.number().int(),
    wageYears: z.number().int(),
  }),
  grievance: z.object({ name: z.string(), phone: z.string() }),
});
export type MyData = z.infer<typeof MyData>;

export const ConsentCreate = z.object({
  kind: ConsentKind,
  version: z.string(),
  lang: z.enum(['en', 'gu']),
});

export const MyRegularisations = z.array(RegularisationView);
export const MyAdvances = z.array(AdvanceView);
