import { z } from 'zod';
import { Divisor, SetupStep, SetupStepState } from './enums';
import { HHMM, Lang, Paise, WorkDate } from './primitives';

/** Overtime rate (PRD 7.6). Multipliers below 2 show a compliance warning in the UI. */
export const OtRate = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('multiplier'),
    multiplier: z.union([z.literal(1), z.literal(1.5), z.literal(2)]),
  }),
  z.object({ mode: z.literal('flat'), paisePerHour: z.number().int().positive() }),
  z.object({ mode: z.literal('comp_off') }),
  z.object({ mode: z.literal('unpaid') }),
]);
export type OtRate = z.infer<typeof OtRate>;

export const AttendanceSettings = z.object({
  graceMin: z.number().int().min(0).max(30),
  earlyToleranceMin: z.number().int().min(0).max(60),
  makeupEnabled: z.boolean(),
  presentPct: z.number().int().min(1).max(100),
  halfPct: z.number().int().min(1).max(100),
  breakAfterMin: z.number().int().min(180).max(480),
  breakPunches: z.boolean(),
  pinEveryPunch: z.boolean(),
  selfieOnCheckIn: z.boolean(),
  selfieOnCheckOut: z.boolean(),
  strongMode: z.boolean(),
  earliestCheckInMin: z.number().int().min(15).max(180),
  /** Owner's closing time; missed check-out alert goes at closing + 60 min. */
  closingTime: HHMM,
  /** Days back a staff member may ask to fix (PRD 4.11). */
  regularisationWindowDays: z.number().int().min(1).max(31),
});
export type AttendanceSettings = z.infer<typeof AttendanceSettings>;

export const RiskSettings = z.object({
  flagAt: z.number().int().min(10).max(90),
  proofAt: z.number().int().min(10).max(90),
});
export type RiskSettings = z.infer<typeof RiskSettings>;

export const OvertimeSettings = z.object({
  thresholdMin: z.number().int().min(0).max(60),
  blockMin: z.union([z.literal(15), z.literal(30), z.literal(60)]),
  rate: OtRate,
  weeklyHoursWarn: z.number().int().min(1).max(84),
  quarterlyOtWarnHours: z.number().int().min(1).max(500),
});
export type OvertimeSettings = z.infer<typeof OvertimeSettings>;

export const MinimumWage = z.object({
  enabled: z.boolean(),
  /** Empty until the owner enters the figure; no warning is shown until then (Q14). */
  amountPaise: Paise.nullable(),
  basis: z.enum(['monthly', 'daily']),
});

export const FinesSettings = z.object({
  enabled: z.boolean(),
  latesPerHalfDay: z.number().int().min(2).max(10),
  noticeText: z.string().max(2000),
});

export const PaySettings = z.object({
  divisor: Divisor,
  weekOffWorked: z.enum(['comp_off', 'extra_pay']),
  offdayMultiplier: z.number().min(1).max(3),
  sandwich: z.boolean(),
  payDay: z.number().int().min(1).max(7),
  minimumWage: MinimumWage,
  dailyPaidHolidays: z.boolean(),
  dailyPaidWeekOffs: z.boolean(),
  showPayslipsToStaff: z.boolean(),
  fines: FinesSettings,
});
export type PaySettings = z.infer<typeof PaySettings>;

export const LeaveSettings = z.object({
  clPerYear: z.number().min(0).max(30),
  slPerYear: z.number().min(0).max(30),
  usableAfterDays: z.number().int().min(0).max(180),
  clNoticeDays: z.number().int().min(0).max(30),
  slBackdateDays: z.number().int().min(0).max(30),
  compOffExpiryDays: z.number().int().min(30).max(120),
  earnedLeave: z.boolean(),
});
export type LeaveSettings = z.infer<typeof LeaveSettings>;

export const NotificationSettings = z.object({
  quietHours: z.object({ enabled: z.boolean(), start: HHMM, end: HHMM }),
  summaryOnly: z.boolean(),
  /** Morning summary at first shift start + this many minutes (default 45 -> 10:45). */
  morningSummaryOffsetMin: z.number().int().min(0).max(180),
  whatsappFallback: z.boolean(),
});
export type NotificationSettings = z.infer<typeof NotificationSettings>;

export const PrivacySettings = z.object({
  noticeVersion: z.string(),
  grievanceName: z.string().max(80),
  grievancePhone: z.string().max(20),
  locationRetentionDays: z.number().int(),
  selfieRetentionDays: z.number().int(),
});
export type PrivacySettings = z.infer<typeof PrivacySettings>;

export const AppSettings = z.object({
  defaultStaffLang: Lang,
});

/** Time credits (PRD 4.19.4, 7.17.1): the switch and the day it starts counting. */
export const TimeCreditsSettings = z.object({
  enabled: z.boolean(),
  /** First day entries are written; earlier days keep the automatic rules of PRD 7.5 and 7.6. */
  startDate: WorkDate,
});
export type TimeCreditsSettings = z.infer<typeof TimeCreditsSettings>;

/** Presence (PRD 4.18, 8.2.1): roll-call times, Step out and the optional foreground check. */
export const PresenceSettings = z.object({
  enabled: z.boolean(),
  /** One to four roll-call times, IST, strictly increasing. */
  rollCallTimes: z.array(HHMM).min(1).max(4),
  stepOut: z.boolean(),
  foreground: z.object({
    enabled: z.boolean(),
    intervalMin: z.number().int().min(10).max(120),
  }),
  quietDuringBreaks: z.boolean(),
});
export type PresenceSettings = z.infer<typeof PresenceSettings>;

export const SetupProgress = z.record(SetupStep, SetupStepState);
export type SetupProgress = z.infer<typeof SetupProgress>;

/** `orgs.settings_json` (PRD 8.2, 7.14). Validated on every write. */
export const OrgSettings = z.object({
  attendance: AttendanceSettings,
  risk: RiskSettings,
  overtime: OvertimeSettings,
  pay: PaySettings,
  leave: LeaveSettings,
  notifications: NotificationSettings,
  privacy: PrivacySettings,
  app: AppSettings,
  timeCredits: TimeCreditsSettings,
  presence: PresenceSettings,
  setup: SetupProgress,
});
export type OrgSettings = z.infer<typeof OrgSettings>;

/** Partial update: each section is optional and shallow-partial. */
export const OrgSettingsPatch = z.object({
  attendance: AttendanceSettings.partial().optional(),
  risk: RiskSettings.partial().optional(),
  overtime: OvertimeSettings.partial().optional(),
  pay: PaySettings.extend({
    minimumWage: MinimumWage.partial(),
    fines: FinesSettings.partial(),
  })
    .partial()
    .optional(),
  leave: LeaveSettings.partial().optional(),
  notifications: NotificationSettings.partial().optional(),
  privacy: PrivacySettings.pick({ grievanceName: true, grievancePhone: true }).partial().optional(),
  app: AppSettings.partial().optional(),
  timeCredits: TimeCreditsSettings.partial().optional(),
  presence: PresenceSettings.extend({ foreground: PresenceSettings.shape.foreground.partial() })
    .partial()
    .optional(),
});
export type OrgSettingsPatch = z.infer<typeof OrgSettingsPatch>;

/** Settings keys whose change needs the owner's step-up PIN (PRD 9.4). */
export const STEP_UP_SETTINGS: ReadonlyArray<readonly [keyof OrgSettings, string]> = [
  ['attendance', 'strongMode'],
  ['risk', 'flagAt'],
  ['risk', 'proofAt'],
  ['timeCredits', 'enabled'],
  ['presence', 'enabled'],
];

/** Defaults we build with (PRD 7.14 and 17.3). */
export const DEFAULT_ORG_SETTINGS: OrgSettings = {
  attendance: {
    graceMin: 10,
    earlyToleranceMin: 15,
    makeupEnabled: true,
    presentPct: 75,
    halfPct: 40,
    breakAfterMin: 300,
    breakPunches: false,
    pinEveryPunch: true,
    selfieOnCheckIn: false,
    selfieOnCheckOut: false,
    strongMode: false,
    earliestCheckInMin: 60,
    closingTime: '20:00',
    regularisationWindowDays: 7,
  },
  risk: { flagAt: 30, proofAt: 60 },
  overtime: {
    thresholdMin: 30,
    blockMin: 15,
    rate: { mode: 'multiplier', multiplier: 2 },
    weeklyHoursWarn: 48,
    quarterlyOtWarnHours: 144,
  },
  pay: {
    divisor: 'calendar',
    weekOffWorked: 'comp_off',
    offdayMultiplier: 2,
    sandwich: false,
    payDay: 5,
    minimumWage: { enabled: true, amountPaise: null, basis: 'monthly' },
    dailyPaidHolidays: true,
    dailyPaidWeekOffs: false,
    showPayslipsToStaff: true,
    fines: { enabled: false, latesPerHalfDay: 3, noticeText: '' },
  },
  leave: {
    clPerYear: 7,
    slPerYear: 7,
    usableAfterDays: 90,
    clNoticeDays: 2,
    slBackdateDays: 3,
    compOffExpiryDays: 60,
    earnedLeave: false,
  },
  notifications: {
    quietHours: { enabled: true, start: '21:30', end: '08:00' },
    summaryOnly: false,
    morningSummaryOffsetMin: 45,
    whatsappFallback: false,
  },
  privacy: {
    noticeVersion: '2026-10-19',
    grievanceName: '',
    grievancePhone: '',
    locationRetentionDays: 90,
    selfieRetentionDays: 30,
  },
  app: { defaultStaffLang: 'en' },
  timeCredits: { enabled: true, startDate: '2026-11-01' },
  presence: {
    enabled: true,
    rollCallTimes: ['12:00', '15:00', '18:00'],
    stepOut: true,
    foreground: { enabled: false, intervalMin: 30 },
    quietDuringBreaks: true,
  },
  setup: {
    salon: 'todo',
    location: 'todo',
    shifts: 'todo',
    holidays: 'todo',
    pay_rules: 'todo',
    selfie: 'todo',
    first_staff: 'todo',
    install: 'todo',
  },
};

/** Salon facts used to prefill setup (PRD 4.15.1, brand research 4.3). */
export const SALON_DEFAULTS = {
  name: 'Feelings Beauty Care',
  address: 'Om Residency, Hirji Mistry Road, near J J Tower, Jamnagar, Gujarat 361006',
  phone: '+918000661578',
  ownerDisplayName: 'Urmi',
  lat: 22.4606479,
  lng: 70.0565093,
  radiusM: 100,
  maxAccuracyM: 50,
} as const;

/** The five default shift templates (PRD 7.3). */
export const DEFAULT_SHIFT_TEMPLATES = [
  { name: 'Full day', segments: [{ start: '10:00', end: '20:00' }], breakMin: 60 },
  { name: 'Sunday', segments: [{ start: '10:00', end: '13:00' }], breakMin: 0 },
  { name: 'Morning', segments: [{ start: '10:00', end: '15:00' }], breakMin: 0 },
  { name: 'Evening', segments: [{ start: '15:00', end: '20:00' }], breakMin: 0 },
  {
    name: 'Split',
    segments: [
      { start: '10:00', end: '14:00' },
      { start: '17:00', end: '21:00' },
    ],
    breakMin: 0,
  },
] as const;

/** National holidays always suggested, plus the five default festival holidays (Q11). */
export const DEFAULT_HOLIDAY_NAMES = [
  'Republic Day',
  'Independence Day',
  'Gandhi Jayanti',
  'Uttarayan',
  'Holi',
  'Janmashtami',
  'Dussehra',
  'Diwali',
] as const;

/** Hard cap on active (non-exited) staff for one salon (Harsh, 19 Oct 2026). */
export const MAX_ACTIVE_STAFF = 15;
