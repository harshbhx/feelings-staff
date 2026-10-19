/**
 * Notification events (PRD 6). Producers emit them through the `Notifier` port; WP-8 turns each into
 * inbox rows, pushes, and later WhatsApp/email. Recipients follow the PRD matrix: owner events go to
 * the owner (and managers with the matching permission), staff events go to `userId`/`userIds`.
 */
import { z } from 'zod';
import { LeaveCode, PunchKind, RegularisationKind, RiskReason } from './enums';
import { Email, EpochMs, HHMM, Id, Paise, WorkDate, YearMonth } from './primitives';

const Base = z.object({ orgId: Id, at: EpochMs });
const Person = { userId: Id, name: z.string() };

export const NotifyEvent = z.discriminatedUnion('type', [
  Base.extend({
    type: z.literal('morning_summary'),
    date: WorkDate,
    present: z.number().int(),
    late: z.number().int(),
    notInYet: z.number().int(),
    onLeave: z.number().int(),
    waitingOver48h: z.number().int(),
  }),
  Base.extend({
    type: z.literal('late_checkin'),
    ...Person,
    workDate: WorkDate,
    lateMin: z.number().int(),
    inTs: EpochMs,
    placeName: z.string().nullable(),
  }),
  Base.extend({ type: z.literal('not_in_yet'), ...Person, workDate: WorkDate, shiftStart: HHMM }),
  Base.extend({
    type: z.literal('checkin_reminder'),
    userId: Id,
    workDate: WorkDate,
    shiftStart: HHMM,
  }),
  Base.extend({
    type: z.literal('flagged_punch'),
    ...Person,
    punchId: Id,
    kind: PunchKind,
    effectiveTs: EpochMs,
    reasons: z.array(RiskReason),
  }),
  Base.extend({
    type: z.literal('punch_needs_approval'),
    ...Person,
    punchId: Id,
    distanceM: z.number().int().nullable(),
    placeName: z.string().nullable(),
    note: z.string().nullable(),
  }),
  Base.extend({
    type: z.literal('punch_decided'),
    userId: Id,
    punchId: Id,
    kind: PunchKind,
    effectiveTs: EpochMs,
    decision: z.enum(['approved', 'rejected']),
    note: z.string().nullable(),
  }),
  Base.extend({
    type: z.literal('early_checkout'),
    ...Person,
    outTs: EpochMs,
    minutesEarly: z.number().int(),
  }),
  Base.extend({
    type: z.literal('overtime_running'),
    ...Person,
    workDate: WorkDate,
    shiftEnd: HHMM,
  }),
  Base.extend({ type: z.literal('checkout_reminder'), userId: Id, workDate: WorkDate }),
  Base.extend({
    type: z.literal('missed_checkouts'),
    workDate: WorkDate,
    people: z.array(z.object({ userId: Id, name: z.string() })),
  }),
  Base.extend({
    type: z.literal('day_auto_closed'),
    userId: Id,
    workDate: WorkDate,
    outTs: EpochMs,
  }),
  Base.extend({
    type: z.literal('leave_requested'),
    ...Person,
    requestId: Id,
    typeCode: LeaveCode,
    fromDate: WorkDate,
    toDate: WorkDate,
    reason: z.string().nullable(),
    /** Starts today or tomorrow: high urgency. */
    urgent: z.boolean(),
  }),
  Base.extend({
    type: z.literal('leave_decided'),
    userId: Id,
    requestId: Id,
    fromDate: WorkDate,
    toDate: WorkDate,
    decision: z.enum(['approved', 'rejected']),
    note: z.string().nullable(),
  }),
  Base.extend({
    type: z.literal('regularisation_requested'),
    ...Person,
    requestId: Id,
    workDate: WorkDate,
    kind: RegularisationKind,
    proposedInTs: EpochMs.nullable(),
    proposedOutTs: EpochMs.nullable(),
  }),
  Base.extend({
    type: z.literal('regularisation_decided'),
    userId: Id,
    requestId: Id,
    workDate: WorkDate,
    decision: z.enum(['approved', 'rejected']),
    note: z.string().nullable(),
  }),
  Base.extend({
    type: z.literal('offsite_requested'),
    ...Person,
    punchId: Id,
    placeName: z.string(),
  }),
  Base.extend({
    type: z.literal('duty_assigned'),
    userIds: z.array(Id).min(1),
    dutyId: Id,
    workDate: WorkDate,
    startTs: EpochMs,
    endTs: EpochMs,
    placeName: z.string(),
    change: z.enum(['created', 'changed', 'cancelled', 'reminder']),
  }),
  Base.extend({ type: z.literal('new_device'), ...Person, deviceId: Id, deviceLabel: z.string() }),
  Base.extend({
    type: z.literal('device_decided'),
    userId: Id,
    deviceId: Id,
    decision: z.enum(['approved', 'rejected']),
  }),
  Base.extend({ type: z.literal('pin_attempts'), ...Person, count: z.number().int() }),
  Base.extend({
    type: z.literal('advance_recorded'),
    userId: Id,
    advanceId: Id,
    amountPaise: Paise,
    givenOn: WorkDate,
    recoverySummary: z.string(),
  }),
  Base.extend({
    type: z.literal('advance_requested'),
    ...Person,
    advanceId: Id,
    amountPaise: Paise,
    reason: z.string(),
  }),
  Base.extend({
    type: z.literal('payroll_draft_ready'),
    runId: Id,
    month: YearMonth,
    blockersCount: z.number().int(),
  }),
  Base.extend({
    type: z.literal('payslip_ready'),
    userIds: z.array(Id).min(1),
    runId: Id,
    month: YearMonth,
  }),
  Base.extend({
    type: z.literal('salary_unpaid'),
    runId: Id,
    month: YearMonth,
    unpaidCount: z.number().int(),
  }),
  Base.extend({
    type: z.literal('payslip_pdf_failed'),
    runId: Id,
    month: YearMonth,
    failedCount: z.number().int(),
  }),
  Base.extend({
    type: z.literal('schedule_changed'),
    userId: Id,
    date: WorkDate,
    summary: z.string(),
  }),
  Base.extend({ type: z.literal('holiday_announced'), date: WorkDate, name: z.string() }),
  Base.extend({ type: z.literal('needs_action_reminder'), count: z.number().int() }),
  Base.extend({
    type: z.literal('weekly_digest'),
    weekStart: WorkDate,
    onTimePct: z.number(),
    otApprovedMin: z.number().int(),
    leaves: z.number().int(),
  }),
  Base.extend({
    type: z.literal('sign_in_link'),
    email: Email,
    url: z.string(),
    /** Never logged. */
    code: z.string().regex(/^\d{6}$/),
  }),
]);
export type NotifyEvent = z.infer<typeof NotifyEvent>;
