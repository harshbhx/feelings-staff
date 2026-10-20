/**
 * Settings sections (PRD 4.17): the list Urmi sees, in this order, each opening a focused page.
 * Rule sections are plain field lists (see fields.ts); the others have their own screens.
 */
import type { IconName } from '@fs/ui';
import type { Field } from './fields';

export type SectionId =
  | 'salon'
  | 'location'
  | 'shifts'
  | 'holidays'
  | 'attendance'
  | 'pay'
  | 'credits'
  | 'leave'
  | 'notifications'
  | 'people'
  | 'privacy'
  | 'security'
  | 'app'
  | 'audit';

export interface SectionDef {
  id: SectionId;
  icon: IconName;
  /** Rule sections are edited with these fields; the rest have their own page. */
  fields?: readonly Field[];
}

const ATTENDANCE: readonly Field[] = [
  {
    id: 'grace',
    path: ['attendance', 'graceMin'],
    kind: 'stepper',
    min: 0,
    max: 30,
    step: 1,
    unit: 'min',
  },
  {
    id: 'early',
    path: ['attendance', 'earlyToleranceMin'],
    kind: 'stepper',
    min: 0,
    max: 60,
    step: 5,
    unit: 'min',
  },
  { id: 'makeup', path: ['attendance', 'makeupEnabled'], kind: 'switch' },
  {
    id: 'present',
    path: ['attendance', 'presentPct'],
    kind: 'stepper',
    min: 50,
    max: 100,
    step: 5,
    unit: 'pct',
  },
  {
    id: 'half',
    path: ['attendance', 'halfPct'],
    kind: 'stepper',
    min: 10,
    max: 75,
    step: 5,
    unit: 'pct',
  },
  {
    id: 'breakAfter',
    path: ['attendance', 'breakAfterMin'],
    kind: 'stepper',
    min: 180,
    max: 480,
    step: 30,
    unit: 'min',
  },
  { id: 'breakPunches', path: ['attendance', 'breakPunches'], kind: 'switch' },
  { id: 'pinEvery', path: ['attendance', 'pinEveryPunch'], kind: 'switch' },
  { id: 'selfieIn', path: ['attendance', 'selfieOnCheckIn'], kind: 'switch' },
  { id: 'selfieOut', path: ['attendance', 'selfieOnCheckOut'], kind: 'switch' },
  { id: 'strong', path: ['attendance', 'strongMode'], kind: 'switch', stepUp: true },
  {
    id: 'earliest',
    path: ['attendance', 'earliestCheckInMin'],
    kind: 'stepper',
    min: 15,
    max: 180,
    step: 15,
    unit: 'min',
  },
  { id: 'closing', path: ['attendance', 'closingTime'], kind: 'time' },
  {
    id: 'fixWindow',
    path: ['attendance', 'regularisationWindowDays'],
    kind: 'stepper',
    min: 1,
    max: 31,
    step: 1,
    unit: 'days',
  },
  {
    id: 'flagAt',
    path: ['risk', 'flagAt'],
    kind: 'stepper',
    min: 10,
    max: 90,
    step: 5,
    stepUp: true,
  },
  {
    id: 'proofAt',
    path: ['risk', 'proofAt'],
    kind: 'stepper',
    min: 10,
    max: 90,
    step: 5,
    stepUp: true,
  },
];

const PAY: readonly Field[] = [
  {
    id: 'divisor',
    path: ['pay', 'divisor'],
    kind: 'choice',
    options: ['calendar', 'fixed30', 'fixed26', 'working'],
  },
  {
    id: 'otThreshold',
    path: ['overtime', 'thresholdMin'],
    kind: 'stepper',
    min: 0,
    max: 60,
    step: 5,
    unit: 'min',
  },
  { id: 'otBlock', path: ['overtime', 'blockMin'], kind: 'choice', options: [15, 30, 60] },
  { id: 'otRate', path: ['overtime', 'rate'], kind: 'otRate' },
  {
    id: 'weekly',
    path: ['overtime', 'weeklyHoursWarn'],
    kind: 'stepper',
    min: 40,
    max: 72,
    step: 1,
    unit: 'h',
  },
  {
    id: 'quarterly',
    path: ['overtime', 'quarterlyOtWarnHours'],
    kind: 'stepper',
    min: 50,
    max: 300,
    step: 10,
    unit: 'h',
  },
  {
    id: 'offday',
    path: ['pay', 'weekOffWorked'],
    kind: 'choice',
    options: ['comp_off', 'extra_pay'],
  },
  { id: 'offdayRate', path: ['pay', 'offdayMultiplier'], kind: 'choice', options: [1, 1.5, 2] },
  { id: 'sandwich', path: ['pay', 'sandwich'], kind: 'switch' },
  { id: 'payDay', path: ['pay', 'payDay'], kind: 'stepper', min: 1, max: 7, step: 1 },
  { id: 'minWage', path: ['pay', 'minimumWage', 'enabled'], kind: 'switch' },
  {
    id: 'minWageAmount',
    path: ['pay', 'minimumWage', 'amountPaise'],
    kind: 'rupees',
    nullable: true,
  },
  {
    id: 'minWageBasis',
    path: ['pay', 'minimumWage', 'basis'],
    kind: 'choice',
    options: ['monthly', 'daily'],
  },
  { id: 'dailyHolidays', path: ['pay', 'dailyPaidHolidays'], kind: 'switch' },
  { id: 'dailyWeekOffs', path: ['pay', 'dailyPaidWeekOffs'], kind: 'switch' },
];

const LEAVE: readonly Field[] = [
  {
    id: 'cl',
    path: ['leave', 'clPerYear'],
    kind: 'stepper',
    min: 0,
    max: 30,
    step: 1,
    unit: 'days',
  },
  {
    id: 'sl',
    path: ['leave', 'slPerYear'],
    kind: 'stepper',
    min: 0,
    max: 30,
    step: 1,
    unit: 'days',
  },
  {
    id: 'usableAfter',
    path: ['leave', 'usableAfterDays'],
    kind: 'stepper',
    min: 0,
    max: 180,
    step: 15,
    unit: 'days',
  },
  {
    id: 'clNotice',
    path: ['leave', 'clNoticeDays'],
    kind: 'stepper',
    min: 0,
    max: 30,
    step: 1,
    unit: 'days',
  },
  {
    id: 'slBackdate',
    path: ['leave', 'slBackdateDays'],
    kind: 'stepper',
    min: 0,
    max: 30,
    step: 1,
    unit: 'days',
  },
  {
    id: 'compOff',
    path: ['leave', 'compOffExpiryDays'],
    kind: 'stepper',
    min: 30,
    max: 120,
    step: 15,
    unit: 'days',
  },
  { id: 'earned', path: ['leave', 'earnedLeave'], kind: 'switch' },
];

/** Time credits (PRD 4.19.4, 7.17.7): both switches need the PIN. */
const CREDITS: readonly Field[] = [
  { id: 'creditsOn', path: ['timeCredits', 'enabled'], kind: 'switch', stepUp: true },
  { id: 'creditsStart', path: ['timeCredits', 'startDate'], kind: 'date' },
  { id: 'legalOt2x', path: ['timeCredits', 'legalOt2x'], kind: 'switch', stepUp: true },
];

const NOTIFICATIONS: readonly Field[] = [
  { id: 'quiet', path: ['notifications', 'quietHours', 'enabled'], kind: 'switch' },
  { id: 'quietStart', path: ['notifications', 'quietHours', 'start'], kind: 'time' },
  { id: 'quietEnd', path: ['notifications', 'quietHours', 'end'], kind: 'time' },
  { id: 'summaryOnly', path: ['notifications', 'summaryOnly'], kind: 'switch' },
  {
    id: 'morning',
    path: ['notifications', 'morningSummaryOffsetMin'],
    kind: 'stepper',
    min: 0,
    max: 180,
    step: 15,
    unit: 'min',
  },
];

const APP: readonly Field[] = [
  { id: 'lang', path: ['app', 'defaultStaffLang'], kind: 'choice', options: ['en', 'gu'] },
  { id: 'payslips', path: ['pay', 'showPayslipsToStaff'], kind: 'switch' },
];

const PRIVACY: readonly Field[] = [
  { id: 'grievanceName', path: ['privacy', 'grievanceName'], kind: 'text', maxLength: 80 },
  { id: 'grievancePhone', path: ['privacy', 'grievancePhone'], kind: 'text', maxLength: 20 },
];

export const SECTIONS: readonly SectionDef[] = [
  { id: 'salon', icon: 'gear' },
  { id: 'location', icon: 'map-pin' },
  { id: 'shifts', icon: 'clock' },
  { id: 'holidays', icon: 'confetti' },
  { id: 'attendance', icon: 'check-circle', fields: ATTENDANCE },
  { id: 'pay', icon: 'currency-inr', fields: PAY },
  { id: 'credits', icon: 'hourglass', fields: CREDITS },
  { id: 'leave', icon: 'airplane-tilt', fields: LEAVE },
  { id: 'notifications', icon: 'bell', fields: NOTIFICATIONS },
  { id: 'people', icon: 'users' },
  { id: 'privacy', icon: 'lock', fields: PRIVACY },
  { id: 'security', icon: 'fingerprint' },
  { id: 'app', icon: 'gear', fields: APP },
  { id: 'audit', icon: 'chart-bar' },
];

export function sectionById(id: string | undefined): SectionDef | undefined {
  return SECTIONS.find((s) => s.id === id);
}
