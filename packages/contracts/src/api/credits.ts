/**
 * Time credits and presence schemas (PRD 4.18, 4.19, 9.4 "Owner: Time credits and presence" and
 * "Staff: presence"). Credits are owner only: no schema in the staff section carries credits,
 * balances or rupee values (PRD 7.17.9).
 */
import { z } from 'zod';
import { CreditSettlement, Fix, PayslipLine, PayslipWarning } from '../engine';
import {
  AwayEndReason,
  AwayReason,
  AwaySource,
  AwayStaffState,
  AwayState,
  CreditKind,
  DistanceBucket,
  PresenceCheckResult,
  RollCallMarkValue,
  RollCallSlotStatus,
} from '../enums';
import {
  Base64Url,
  Cursor,
  EpochMs,
  HHMM,
  Id,
  Minutes,
  Note,
  Paise,
  PersonBrief,
  paginated,
  Reason,
  WorkDate,
} from '../primitives';

// ---- Credits: overview and ledger (owner) ---------------------------------------------------

export const CreditsQuery = z.object({ asOf: WorkDate.optional() });

export const CreditsRow = z.object({
  userId: Id,
  name: z.string(),
  /** Signed minutes as of the asked date. */
  balanceMin: Minutes,
  /** The balance at the 1x rate from the person's current rate (PRD 7.17.4); signed paise. */
  estimatePaise: Paise,
  lastSettlement: z
    .object({ month: z.string(), appliedMin: Minutes, amountPaise: Paise })
    .optional(),
  /** Step-outs still waiting for the owner's decision. */
  awayPending: z.number().int(),
});
export type CreditsRow = z.infer<typeof CreditsRow>;

export const CreditsOverview = z.object({
  enabled: z.boolean(),
  staff: z.array(CreditsRow),
  asOf: WorkDate,
});
export type CreditsOverview = z.infer<typeof CreditsOverview>;

export const CreditUserParams = z.object({ userId: Id });

/** A ledger row is an entry kind, or `settled` for a settlement (PRD 9.4). */
export const CreditLedgerKind = z.enum([...CreditKind.options, 'settled']);
export type CreditLedgerKind = z.infer<typeof CreditLedgerKind>;

export const CreditLedgerQuery = z.object({
  from: WorkDate.optional(),
  to: WorkDate.optional(),
  kind: CreditLedgerKind.optional(),
  /** Only entries not yet settled by a finalised settlement. */
  unsettled: z.stringbool().optional(),
  cursor: Cursor.optional(),
});

export const CreditHistoryItem = z.object({
  /** `original` is the derived entry; `adjustment` and `void` are the owner's edits. */
  kind: z.enum(['original', 'adjustment', 'void']),
  minutes: Minutes,
  reason: z.string().nullable(),
  by: PersonBrief.pick({ id: true, name: true }).nullable(),
  at: EpochMs,
  adjustmentId: Id.nullable(),
});
export type CreditHistoryItem = z.infer<typeof CreditHistoryItem>;

export const CreditLedgerRow = z.object({
  date: WorkDate,
  kind: CreditLedgerKind,
  /** The derived entry's signed minutes (settled rows: minus the applied minutes). */
  minutes: Minutes,
  /** Sum of the active adjustments on this day and kind. */
  adjustedMin: Minutes,
  runningBalanceMin: Minutes,
  source: z.object({
    kind: z.enum(['punch', 'presence', 'ot_decision', 'settlement', 'adjustment']),
    id: z.string(),
  }),
  /** Who confirmed it; absent for automatic late and early entries. */
  confirmedBy: PersonBrief.pick({ id: true, name: true }).optional(),
  history: z.array(CreditHistoryItem),
});
export type CreditLedgerRow = z.infer<typeof CreditLedgerRow>;

export const CreditLedger = paginated(CreditLedgerRow).extend({
  balanceMin: Minutes,
  estimatePaise: Paise,
});
export type CreditLedger = z.infer<typeof CreditLedger>;

// ---- Credits: adjustments (owner) -----------------------------------------------------------

export const CreditAdjustmentCreate = z.object({
  workDate: WorkDate,
  kind: CreditKind,
  deltaMin: Minutes.refine((m) => m !== 0, 'An adjustment is never 0'),
  reason: Reason,
});
export type CreditAdjustmentCreate = z.infer<typeof CreditAdjustmentCreate>;

export const CreditAdjustmentPatch = z.object({
  deltaMin: Minutes.refine((m) => m !== 0, 'An adjustment is never 0').optional(),
  reason: Reason,
});
export type CreditAdjustmentPatch = z.infer<typeof CreditAdjustmentPatch>;

export const CreditAdjustmentVoid = z.object({ reason: Reason });

// ---- Credits: settle step of a payroll run (owner) ------------------------------------------

export const CreditsSettleRow = z.object({
  userId: Id,
  name: z.string(),
  /** Balance at the month end, signed. */
  balanceMin: Minutes,
  /** The full balance (PRD 4.19.3). */
  suggestedMin: Minutes,
  /** The owner's current choice; 0 until chosen. */
  settleMin: Minutes,
  /** After the 50% cap. */
  appliedMin: Minutes,
  amountPaise: Paise,
  /** Minutes of the balance that stay (cap or choice). */
  stayMin: Minutes,
});
export type CreditsSettleRow = z.infer<typeof CreditsSettleRow>;

export const CreditsSettleView = z.object({ rows: z.array(CreditsSettleRow) });
export type CreditsSettleView = z.infer<typeof CreditsSettleView>;

export const CreditSettleRequest = z.object({ settleMin: Minutes });

/** The saved settlement and the person's recomputed payslip lines and warnings. */
export const CreditSettleResult = z.object({
  settlement: CreditSettlement,
  lines: z.array(PayslipLine),
  warnings: z.array(PayslipWarning),
});
export type CreditSettleResult = z.infer<typeof CreditSettleResult>;

// ---- Presence: shared views -----------------------------------------------------------------

/** An away interval as the owner and managers see it. */
export const AwayIntervalView = z.object({
  id: Id,
  user: PersonBrief,
  workDate: WorkDate,
  source: AwaySource,
  reason: AwayReason.nullable(),
  reasonNote: z.string().nullable(),
  staffNote: z.string().nullable(),
  startTs: EpochMs,
  /** Null while open. */
  endTs: EpochMs.nullable(),
  /** Counted minutes (clipped, PRD 7.18 rule 3). */
  minutes: Minutes,
  state: AwayState,
  endReason: AwayEndReason.nullable(),
  backMissing: z.boolean(),
  rollCallId: Id.nullable(),
  /** The staff member, or the owner or manager who marked the person away. */
  openedBy: PersonBrief.pick({ id: true, name: true }),
  decidedBy: PersonBrief.pick({ id: true, name: true }).nullable(),
  decidedAt: EpochMs.nullable(),
  editedAt: EpochMs.nullable(),
});
export type AwayIntervalView = z.infer<typeof AwayIntervalView>;

/** An away interval as the staff member sees it: no minutes of credit, no rupees. */
export const AwayIntervalStaff = z.object({
  id: Id,
  workDate: WorkDate,
  source: AwaySource,
  reason: AwayReason.nullable(),
  /** Set when the owner or a manager marked the person away ("Urmi marked you away since 15:00"). */
  markedByName: z.string().nullable(),
  staffNote: z.string().nullable(),
  startTs: EpochMs,
  endTs: EpochMs.nullable(),
  /** How long the person was out, for "You were out 40 min". */
  awayMin: Minutes,
  state: AwayStaffState,
});
export type AwayIntervalStaff = z.infer<typeof AwayIntervalStaff>;

// ---- Presence: roll-calls (owner and managers with `rollcall`) ------------------------------

export const RollCallDayQuery = z.object({ date: WorkDate.optional() });

export const RollCallSlot = z.object({
  id: Id,
  slotTime: HHMM,
  status: RollCallSlotStatus,
  submittedBy: PersonBrief.pick({ id: true, name: true }).optional(),
});
export type RollCallSlot = z.infer<typeof RollCallSlot>;

export const RollCallDay = z.object({ slots: z.array(RollCallSlot) });
export type RollCallDay = z.infer<typeof RollCallDay>;

export const RollCallPerson = z.object({
  userId: Id,
  name: z.string(),
  inAt: EpochMs,
  state: z.enum(['here', 'away_open', 'on_break']),
  awaySince: EpochMs.optional(),
  hint: z.enum(['seems_away', 'stepped_out']).optional(),
  /** E.g. "lunch outside, since 14:40" for a step-out hint. */
  hintDetail: z.string().optional(),
  /**
   * The mark saved at this roll-call, absent until it is submitted. Reopening a done roll-call
   * starts from these marks, and a re-submit only acts on the people whose mark changed.
   */
  mark: z.enum(['here', 'not_here']).optional(),
});
export type RollCallPerson = z.infer<typeof RollCallPerson>;

export const RollCallView = z.object({
  id: Id,
  slotTime: HHMM,
  /** Lists only people checked in at the slot time. */
  people: z.array(RollCallPerson),
});
export type RollCallView = z.infer<typeof RollCallView>;

export const RollCallSubmit = z.object({
  notHere: z.array(Id),
  here: z.array(Id),
  idempotencyKey: z.string().min(16).max(64),
});
export type RollCallSubmit = z.infer<typeof RollCallSubmit>;

export const RollCallResult = z.object({
  started: z.array(Id),
  continued: z.array(Id),
  ended: z.array(Id),
});
export type RollCallResult = z.infer<typeof RollCallResult>;

// ---- Presence: away intervals (owner and managers) ------------------------------------------

export const AwayListQuery = z.object({ state: AwayState.optional() });

export const AwayPatch = z.object({
  startTs: EpochMs.optional(),
  endTs: EpochMs.optional(),
  reason: AwayReason.optional(),
  reasonNote: Note.optional(),
  state: z.enum(['confirmed', 'work', 'ignored']).optional(),
  editReason: Reason,
});
export type AwayPatch = z.infer<typeof AwayPatch>;

export const AwayDecideRequest = z.object({
  decision: z.enum(['confirm', 'work', 'ignore']),
  note: Note.optional(),
});
export type AwayDecideRequest = z.infer<typeof AwayDecideRequest>;

export const OwnerRollCallMark = z.object({
  rollCallId: Id,
  slotTime: HHMM,
  mark: RollCallMarkValue,
  markedBy: PersonBrief.pick({ id: true, name: true }),
  markedAt: EpochMs,
});

export const OwnerPresenceCheck = z.object({
  id: Id,
  ts: EpochMs,
  result: PresenceCheckResult,
  distanceBucket: DistanceBucket.nullable(),
});

/** One person's presence on one day (also inside `OwnerDayDetail` on screen). */
export const OwnerPresenceDay = z.object({
  rollCalls: z.array(OwnerRollCallMark),
  away: z.array(AwayIntervalView),
  checks: z.array(OwnerPresenceCheck),
});
export type OwnerPresenceDay = z.infer<typeof OwnerPresenceDay>;

// ---- Presence: staff ------------------------------------------------------------------------

export const PresenceState = z.object({
  enabled: z.boolean(),
  /** The person has not acknowledged presence tracking yet. */
  consentNeeded: z.boolean(),
  stepOutEnabled: z.boolean(),
  openAway: AwayIntervalStaff.optional(),
  foreground: z.object({ intervalMin: z.number().int(), nextDueAt: EpochMs }).optional(),
});
export type PresenceState = z.infer<typeof PresenceState>;

export const StepOutRequest = z.object({
  reason: AwayReason,
  note: Note.optional(),
  idempotencyKey: z.string().min(16).max(64),
});
export type StepOutRequest = z.infer<typeof StepOutRequest>;

export const BackRequest = z.object({ idempotencyKey: z.string().min(16).max(64) });
export type BackRequest = z.infer<typeof BackRequest>;

export const AwayNoteRequest = z.object({ note: Note.min(1) });
export type AwayNoteRequest = z.infer<typeof AwayNoteRequest>;

/**
 * The signed foreground check (PRD 7.18 rule 6, 9.4). Signed like a punch with the device key over
 * the canonical JSON of every field except `signature`; the nonce is of purpose `presence`.
 */
export const PresenceCheckRequest = z.object({
  v: z.literal(1),
  nonce: Base64Url,
  deviceId: Id,
  clientTs: EpochMs,
  fix: Fix.pick({
    lat: true,
    lng: true,
    accuracy: true,
    samples: true,
    spreadM: true,
    altitudeNullAll: true,
    speedNullAll: true,
  }).nullable(),
  deviceTz: z.string().max(64),
  idempotencyKey: z.string().min(16).max(64),
  signature: Base64Url,
});
export type PresenceCheckRequest = z.infer<typeof PresenceCheckRequest>;

export const PresenceCheckResultView = z.object({ result: PresenceCheckResult });

export const PresenceHistoryQuery = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
});

export const MyRollCallMark = z.object({
  workDate: WorkDate,
  slotTime: HHMM,
  mark: RollCallMarkValue,
});

export const MyPresenceCheck = z.object({
  ts: EpochMs,
  result: PresenceCheckResult,
  distanceBucket: DistanceBucket.nullable(),
});

/** Staff's own presence log: marks, intervals (Waiting, Counted, Work, Ignored) and checks. */
export const PresenceHistory = z.object({
  rollCalls: z.array(MyRollCallMark),
  away: z.array(AwayIntervalStaff),
  checks: z.array(MyPresenceCheck),
});
export type PresenceHistory = z.infer<typeof PresenceHistory>;

/** One row of `MyData.presence`. */
export const MyPresenceItem = z.discriminatedUnion('kind', [
  MyRollCallMark.extend({ kind: z.literal('roll_call') }),
  AwayIntervalStaff.extend({ kind: z.literal('away') }),
  MyPresenceCheck.extend({ kind: z.literal('check') }),
]);
export type MyPresenceItem = z.infer<typeof MyPresenceItem>;
