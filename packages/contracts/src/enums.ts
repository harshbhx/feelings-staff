import { z } from 'zod';

export const Role = z.enum(['owner', 'manager', 'staff']);
export type Role = z.infer<typeof Role>;

export const UserStatus = z.enum(['invited', 'active', 'suspended', 'exited']);
export type UserStatus = z.infer<typeof UserStatus>;

/** Manager permissions (PRD 10.2). The owner implicitly has all of them. */
export const Permission = z.enum([
  'approve_attendance',
  'approve_leave',
  'approve_overtime',
  'offsite',
  'roster',
  'door',
  'payroll',
  'staff',
  'exports',
  'rollcall',
]);
export type Permission = z.infer<typeof Permission>;

export const Platform = z.enum(['android', 'ios', 'desktop', 'other']);
export type Platform = z.infer<typeof Platform>;

export const DeviceStatus = z.enum(['pending', 'approved', 'rejected', 'revoked']);
export type DeviceStatus = z.infer<typeof DeviceStatus>;

export const PunchKind = z.enum(['in', 'out', 'break_start', 'break_end']);
export type PunchKind = z.infer<typeof PunchKind>;

export const PunchSource = z.enum(['online', 'offline', 'owner', 'auto']);
export type PunchSource = z.infer<typeof PunchSource>;

export const PunchStatus = z.enum(['accepted', 'flagged', 'pending', 'rejected', 'superseded']);
export type PunchStatus = z.infer<typeof PunchStatus>;

export const FenceResult = z.enum(['pass', 'uncertain', 'outside', 'approximate', 'none']);
export type FenceResult = z.infer<typeof FenceResult>;

export const DistanceBucket = z.enum(['0-50', '50-100', '100-200', '200-500', '500+']);
export type DistanceBucket = z.infer<typeof DistanceBucket>;

/** Risk signals (PRD 4.4.3). Points live in packages/engine/src/risk. */
export const RiskReason = z.enum([
  'fence_uncertain',
  'zero_jitter',
  'replayed_point',
  'impossible_jump',
  'network_suspect',
  'device_tz',
  'clock_skew',
  'new_device',
  'offline',
  'salon_network',
  'door_qr',
  'offsite_duty',
]);
export type RiskReason = z.infer<typeof RiskReason>;

/** Why a punch is pending (not yet counted). */
export const PendingReason = z.enum([
  'needs_proof',
  'outside_fence',
  'selfie_missing',
  'offsite_unplanned',
  'duty_approval',
  'strong_mode',
  'too_early',
  'late_sync',
  'offline_window',
  'consent_withdrawn',
]);
export type PendingReason = z.infer<typeof PendingReason>;

/** What the server decided for a punch, as shown to the staff member. */
export const PunchOutcome = z.enum(['accepted', 'flagged', 'needs_proof', 'pending']);
export type PunchOutcome = z.infer<typeof PunchOutcome>;

export const DayType = z.enum(['work', 'WO', 'HO', 'NE']);
export type DayType = z.infer<typeof DayType>;

export const DayStatus = z.enum(['P', 'H', 'A', 'L', 'LOP', 'WO', 'HO', 'NE', 'OPEN']);
export type DayStatus = z.infer<typeof DayStatus>;

/** Statuses the owner can set with an override (PRD 4.12). */
export const OverrideStatus = z.enum(['P', 'H', 'A', 'L', 'LOP', 'WO', 'HO']);
export type OverrideStatus = z.infer<typeof OverrideStatus>;

export const DayTag = z.enum([
  'late',
  'early',
  'ot',
  'offsite',
  'offline',
  'auto_closed',
  'edited',
  'break_not_punched',
  'night_hours',
  'flagged',
  'pending',
  'worked_off_day',
  'away',
  'overbreak',
  'left_no_checkout',
]);
export type DayTag = z.infer<typeof DayTag>;

export const OtStatus = z.enum(['none', 'pending', 'approved', 'partial', 'rejected']);
export type OtStatus = z.infer<typeof OtStatus>;

export const LeaveCode = z.enum(['CL', 'SL', 'EL', 'CO', 'LOP']);
export type LeaveCode = z.infer<typeof LeaveCode>;

export const HalfDayPart = z.enum(['none', 'first', 'second']);
export type HalfDayPart = z.infer<typeof HalfDayPart>;

export const RequestStatus = z.enum(['pending', 'approved', 'rejected', 'cancelled']);
export type RequestStatus = z.infer<typeof RequestStatus>;

export const RegularisationKind = z.enum([
  'missed_in',
  'missed_out',
  'wrong_time',
  'offsite_unplanned',
]);
export type RegularisationKind = z.infer<typeof RegularisationKind>;

export const SalaryType = z.enum(['monthly', 'daily']);
export type SalaryType = z.infer<typeof SalaryType>;

export const Divisor = z.enum(['calendar', 'fixed30', 'fixed26', 'working']);
export type Divisor = z.infer<typeof Divisor>;

export const OtRateMode = z.enum(['multiplier', 'flat', 'comp_off', 'unpaid']);
export type OtRateMode = z.infer<typeof OtRateMode>;

export const OffsiteMode = z.enum(['geofence', 'anywhere', 'approval']);
export type OffsiteMode = z.infer<typeof OffsiteMode>;

export const SiteKind = z.enum(['salon', 'venue']);
export type SiteKind = z.infer<typeof SiteKind>;

export const WorkedOffDayComp = z.enum(['comp_off', 'extra_pay', 'both']);
export type WorkedOffDayComp = z.infer<typeof WorkedOffDayComp>;

export const PayMode = z.enum(['cash', 'upi', 'bank']);
export type PayMode = z.infer<typeof PayMode>;

export const AdvancePlan = z.enum(['full', 'instalments']);
export type AdvancePlan = z.infer<typeof AdvancePlan>;

export const AdvanceStatus = z.enum(['requested', 'active', 'closed', 'rejected', 'cancelled']);
export type AdvanceStatus = z.infer<typeof AdvanceStatus>;

export const AdvanceAck = z.enum(['pending', 'confirmed', 'disputed']);
export type AdvanceAck = z.infer<typeof AdvanceAck>;

export const AdjustmentKind = z.enum([
  'incentive',
  'bonus',
  'other_earning',
  'arrears',
  'damage',
  'other_deduction',
  'recovery',
]);
export type AdjustmentKind = z.infer<typeof AdjustmentKind>;

export const PayrollRunStatus = z.enum(['draft', 'finalised', 'superseded']);
export type PayrollRunStatus = z.infer<typeof PayrollRunStatus>;

export const PdfStatus = z.enum(['pending', 'ready', 'failed']);
export type PdfStatus = z.infer<typeof PdfStatus>;

/** Every line code a payslip can carry (PRD 4.14, 7.13). */
export const PayslipLineCode = z.enum([
  'salary',
  'basic',
  'overtime',
  'offday_extra',
  'incentive',
  'bonus',
  'other_earning',
  'arrears',
  'lop',
  'undertime',
  'statutory',
  'fine',
  'damage',
  'other_deduction',
  'recovery',
  'advance_recovery',
  'rounding',
  'time_credits',
]);
export type PayslipLineCode = z.infer<typeof PayslipLineCode>;

export const ExportKind = z.enum([
  'register',
  'salary_register',
  'punches',
  'late_early',
  'overtime',
  'leave',
  'advances',
  'exceptions',
  'audit',
  'credits_ledger',
  'presence_log',
]);
export type ExportKind = z.infer<typeof ExportKind>;

export const ExportFormat = z.enum(['csv', 'pdf']);
export type ExportFormat = z.infer<typeof ExportFormat>;

export const ExportStatus = z.enum(['queued', 'ready', 'failed']);
export type ExportStatus = z.infer<typeof ExportStatus>;

export const ConsentKind = z.enum([
  'privacy_notice',
  'selfie',
  'night_work',
  'fines_notice',
  'presence_checks',
]);
export type ConsentKind = z.infer<typeof ConsentKind>;

export const AuditCategory = z.enum(['change', 'security', 'access', 'export']);
export type AuditCategory = z.infer<typeof AuditCategory>;

export const AuditActorType = z.enum(['user', 'system', 'door']);
export type AuditActorType = z.infer<typeof AuditActorType>;

export const NotificationPriority = z.enum(['high', 'normal']);
export type NotificationPriority = z.infer<typeof NotificationPriority>;

export const PushStatus = z.enum(['none', 'held', 'queued', 'sent', 'failed']);
export type PushStatus = z.infer<typeof PushStatus>;

/**
 * Notification events N1-N37 (PRD 6). The value is the stable code stored in
 * `notifications.type`; NOTIFY_EVENT_NUMBER maps it to its N-number.
 */
export const NotifyEventType = z.enum([
  'morning_summary',
  'late_checkin',
  'not_in_yet',
  'checkin_reminder',
  'flagged_punch',
  'punch_needs_approval',
  'punch_decided',
  'early_checkout',
  'overtime_running',
  'checkout_reminder',
  'missed_checkouts',
  'day_auto_closed',
  'leave_requested',
  'leave_decided',
  'regularisation_requested',
  'regularisation_decided',
  'offsite_requested',
  'duty_assigned',
  'new_device',
  'device_decided',
  'pin_attempts',
  'advance_recorded',
  'advance_requested',
  'payroll_draft_ready',
  'payslip_ready',
  'salary_unpaid',
  'schedule_changed',
  'holiday_announced',
  'needs_action_reminder',
  'weekly_digest',
  'sign_in_link',
  'payslip_pdf_failed',
  'roll_call_due',
  'roll_call_missed',
  'staff_stepped_out',
  'away_to_confirm',
  'left_without_checkout',
]);
export type NotifyEventType = z.infer<typeof NotifyEventType>;

export const NOTIFY_EVENT_NUMBER: Record<NotifyEventType, number> = {
  morning_summary: 1,
  late_checkin: 2,
  not_in_yet: 3,
  checkin_reminder: 4,
  flagged_punch: 5,
  punch_needs_approval: 6,
  punch_decided: 7,
  early_checkout: 8,
  overtime_running: 9,
  checkout_reminder: 10,
  missed_checkouts: 11,
  day_auto_closed: 12,
  leave_requested: 13,
  leave_decided: 14,
  regularisation_requested: 15,
  regularisation_decided: 16,
  offsite_requested: 17,
  duty_assigned: 18,
  new_device: 19,
  device_decided: 20,
  pin_attempts: 21,
  advance_recorded: 22,
  advance_requested: 23,
  payroll_draft_ready: 24,
  payslip_ready: 25,
  salary_unpaid: 26,
  schedule_changed: 27,
  holiday_announced: 28,
  needs_action_reminder: 29,
  weekly_digest: 30,
  sign_in_link: 31,
  payslip_pdf_failed: 37,
  roll_call_due: 32,
  roll_call_missed: 33,
  staff_stepped_out: 34,
  away_to_confirm: 35,
  left_without_checkout: 36,
};

/** Events whose push the recipient cannot switch off (PRD 6, delivery rules). */
export const SECURITY_EVENTS: readonly NotifyEventType[] = [
  'new_device',
  'pin_attempts',
  'sign_in_link',
];

/** Needs-action item types (PRD 4.12). */
export const ActionType = z.enum([
  'flagged_punch',
  'pending_punch',
  'new_device',
  'leave_request',
  'regularisation',
  'overtime',
  'offsite_request',
  'auto_closed',
  'advance_request',
  'away',
]);
export type ActionType = z.infer<typeof ActionType>;

export const SetupStep = z.enum([
  'salon',
  'location',
  'shifts',
  'holidays',
  'pay_rules',
  'selfie',
  'first_staff',
  'install',
]);
export type SetupStep = z.infer<typeof SetupStep>;

export const SetupStepState = z.enum(['todo', 'done', 'skipped']);
export type SetupStepState = z.infer<typeof SetupStepState>;

export const Weekday = z.number().int().min(0).max(6); // 0 = Sunday
export type Weekday = z.infer<typeof Weekday>;

export const Designation = z.enum([
  'Stylist',
  'Beautician',
  'Makeup artist',
  'Mehndi artist',
  'Nail technician',
  'Receptionist',
  'Helper',
  'Trainer',
  'Trainee',
  'Other',
]);
export type Designation = z.infer<typeof Designation>;

// ---- Time credits and presence (PRD 7.17, 7.18, 8.2.1) -----------------------------------------

/** The four kinds of credit entry: minus for late, early and away, plus for approved overtime. */
export const CreditKind = z.enum(['late', 'early', 'away', 'ot']);
export type CreditKind = z.infer<typeof CreditKind>;

/** What a credit entry points at: a punch, a presence interval or an overtime decision. */
export const CreditSourceKind = z.enum(['punch', 'presence', 'ot_decision']);
export type CreditSourceKind = z.infer<typeof CreditSourceKind>;

export const CreditAdjustmentStatus = z.enum(['active', 'void']);
export type CreditAdjustmentStatus = z.infer<typeof CreditAdjustmentStatus>;

export const CreditSettlementStatus = z.enum(['draft', 'applied', 'void']);
export type CreditSettlementStatus = z.infer<typeof CreditSettlementStatus>;

/** How an away interval started: a roll-call mark, a staff Step out, or both merged. */
export const AwaySource = z.enum(['roll_call', 'step_out', 'mixed']);
export type AwaySource = z.infer<typeof AwaySource>;

/** The Step out reason chips (personal, lunch outside, work errand, other). */
export const AwayReason = z.enum(['personal', 'lunch', 'errand', 'other']);
export type AwayReason = z.infer<typeof AwayReason>;

/** State of an away interval: open while running, pending until the owner decides a step-out. */
export const AwayState = z.enum(['open', 'pending', 'confirmed', 'work', 'ignored']);
export type AwayState = z.infer<typeof AwayState>;

/** What staff see of an interval: Waiting, Counted, Work or Ignored (never minutes of credit). */
export const AwayStaffState = z.enum(['open', 'waiting', 'counted', 'work', 'ignored']);
export type AwayStaffState = z.infer<typeof AwayStaffState>;

export const AwayEndReason = z.enum([
  'back',
  'roll_call_here',
  'check_out',
  'auto_close',
  'shift_end',
  'owner_edit',
]);
export type AwayEndReason = z.infer<typeof AwayEndReason>;

export const RollCallMarkValue = z.enum(['here', 'not_here']);
export type RollCallMarkValue = z.infer<typeof RollCallMarkValue>;

export const RollCallSlotStatus = z.enum(['upcoming', 'open', 'done', 'missed']);
export type RollCallSlotStatus = z.infer<typeof RollCallSlotStatus>;

/** Result of one foreground presence check. */
export const PresenceCheckResult = z.enum(['inside', 'edge', 'outside', 'no_fix']);
export type PresenceCheckResult = z.infer<typeof PresenceCheckResult>;

/** Audit actions added by WP-9 (PRD 8.2.1). */
export const CREDIT_AUDIT_ACTIONS = [
  'credits.settle',
  'credits.adjust',
  'credits.adjust.void',
  'credits.export',
  'rollcall.submit',
  'rollcall.edit',
  'presence.away.confirm',
  'presence.away.work',
  'presence.away.ignore',
  'presence.away.edit',
  'presence.step_out',
] as const;
