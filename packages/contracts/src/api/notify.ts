/** Notifications, push, door device, public verify and test-only schemas. */
import { z } from 'zod';
import { NotificationPriority, NotifyEventType } from '../enums';
import {
  Base64Url,
  Cursor,
  EpochMs,
  Id,
  Paise,
  paginated,
  WorkDate,
  YearMonth,
} from '../primitives';

export const NotificationView = z.object({
  id: Id,
  type: NotifyEventType,
  title: z.string(),
  body: z.string().nullable(),
  /** In-app path to open, e.g. `/o/actions` or `/day/2026-10-19`. */
  url: z.string(),
  priority: NotificationPriority,
  data: z.record(z.string(), z.unknown()).nullable(),
  readAt: EpochMs.nullable(),
  createdAt: EpochMs,
});
export type NotificationView = z.infer<typeof NotificationView>;

export const NotificationsQuery = z.object({ cursor: Cursor.optional() });
export const NotificationsPage = paginated(NotificationView).extend({ unread: z.number().int() });
export type NotificationsPage = z.infer<typeof NotificationsPage>;

export const NotificationsReadRequest = z.union([
  z.object({ ids: z.array(Id).min(1).max(200) }),
  z.object({ all: z.literal(true) }),
]);

export const PushSubscribeRequest = z.object({
  endpoint: z.url().max(1000),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({ p256dh: Base64Url, auth: Base64Url }),
  platform: z.enum(['android', 'ios', 'desktop', 'other']),
});
export type PushSubscribeRequest = z.infer<typeof PushSubscribeRequest>;
export const PushUnsubscribeRequest = z.object({ endpoint: z.url().max(1000) });

export const NotificationPrefs = z.object({
  events: z.array(
    z.object({
      type: NotifyEventType,
      push: z.boolean(),
      whatsapp: z.boolean(),
      email: z.boolean(),
      /** Security events cannot be switched off. */
      locked: z.boolean(),
    }),
  ),
});
export type NotificationPrefs = z.infer<typeof NotificationPrefs>;

/**
 * Push payload (PRD 6, Declarative Web Push shape) plus `t` (type), `e` (event id), `topic`, `badge`.
 * Must stay under 2 KB once serialised.
 */
export const PushPayload = z.object({
  web_push: z.literal(8030),
  notification: z.object({
    title: z.string(),
    body: z.string().optional(),
    navigate: z.string(),
    lang: z.string().optional(),
    app_badge: z.string().optional(),
  }),
  t: NotifyEventType,
  e: Id,
  topic: z.string().max(32).optional(),
  badge: z.number().int().optional(),
});
export type PushPayload = z.infer<typeof PushPayload>;

// ---- Door device ------------------------------------------------------------------

export const DoorPairRequest = z.object({ pairingCode: z.string().min(8).max(10) });
export const DoorPairResult = z.object({
  doorDeviceId: Id,
  siteId: Id,
  siteName: z.string(),
  /** 32 random bytes, base64url. Stored in IndexedDB on the door device. */
  secret: Base64Url,
  serverTime: EpochMs,
});
export const DoorStatus = z.object({
  lastCheckIn: z.object({ firstName: z.string(), at: EpochMs }).nullable(),
  serverTime: EpochMs,
});
export type DoorStatus = z.infer<typeof DoorStatus>;
/** Current secret of a paired door device; the door screen reads it hourly so a rotation reaches it. */
export const DoorSecret = z.object({
  secret: Base64Url,
  /** Bumps on every rotation. */
  secretVersion: z.number().int().min(1),
  serverTime: EpochMs,
});
export type DoorSecret = z.infer<typeof DoorSecret>;

// ---- Public ---------------------------------------------------------------------

export const VerifyTokenParams = z.object({ token: z.string().min(16).max(40) });
export const PayslipVerify = z.object({
  valid: z.boolean(),
  orgName: z.string().nullable(),
  /** First name + initial, e.g. "Priya S.". */
  staffName: z.string().nullable(),
  month: YearMonth.nullable(),
  netPaise: Paise.nullable(),
  revision: z.number().int().nullable(),
  superseded: z.boolean(),
});
export type PayslipVerify = z.infer<typeof PayslipVerify>;

// ---- Test-only (preview and local; X-E2E-Token) ---------------------------------------

export const TestScenario = z.enum(['empty', 'basic-salon', 'payroll-october', 'demo']);
export type TestScenario = z.infer<typeof TestScenario>;
export const TestResetRequest = z.object({ scenario: TestScenario });
export const TestResetResult = z.object({
  orgId: Id,
  /** Ready-made credentials for the scenario (test data only). */
  owner: z.object({
    email: z.string(),
    password: z.string().nullable(),
    pin: z.string().nullable(),
  }),
  staff: z.array(
    z.object({
      id: Id,
      name: z.string(),
      phone: z.string(),
      pin: z.string().nullable(),
      joinCode: z.string().nullable(),
    }),
  ),
});
export type TestResetResult = z.infer<typeof TestResetResult>;
export const TestClockRequest = z.object({ nowMs: EpochMs.nullable() });
export const TestClockResult = z.object({ nowMs: EpochMs, fake: z.boolean() });
/**
 * Run a scheduled job now. `recompute-day` (test-only, added in contracts 1.1) recomputes every
 * person-day of `date` through DayService; the demo seed uses it to build history day by day.
 */
export const TestCronRequest = z.object({
  job: z.enum(['rules', 'nightly', 'recompute-day']),
  at: EpochMs.optional(),
  date: WorkDate.optional(),
});
export const TestCronResult = z.object({
  job: z.string(),
  at: EpochMs,
  summary: z.record(z.string(), z.unknown()),
});
export const OutboxItem = z.object({
  channel: z.enum(['push', 'email', 'whatsapp']),
  to: z.string(),
  at: EpochMs,
  payload: z.unknown(),
});
export const TestOutbox = z.object({ items: z.array(OutboxItem) });
