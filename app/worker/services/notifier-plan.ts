/**
 * What each notification event means (PRD 6): who gets it, how urgent it is, how long a push lives,
 * which topic collapses it, and its copy. Pure functions; the Notifier does the I/O. Owner: WP-8.
 */
import {
  formatDuration,
  formatRupees,
  istDate,
  istTime,
  type NotifyEvent,
  type NotifyEventType,
  type Permission,
} from '@fs/contracts';
import { type AppLang, createI18n, formatDate, formatMonth } from '@fs/i18n';

export type Audience = 'owner' | 'staff' | 'email';

export const ALERT_TTL_SEC = 4 * 3600;
export const SUMMARY_TTL_SEC = 12 * 3600;

export interface Plan {
  audience: Audience;
  /** Managers need this permission to receive an owner event; null means owner only. */
  permission: Permission | null;
  /** Staff events: the people to notify (all active staff when `everyone`). */
  userIds: string[];
  everyone: boolean;
  priority: 'high' | 'normal';
  urgency: 'high' | 'normal';
  ttlSec: number;
  /** Push topic (at most 32 characters) or null. */
  topic: string | null;
  /** Same-type owner alerts within 5 minutes merge into one push. */
  batchable: boolean;
  /** Push is on unless the person switches it off (false: in-app only until they opt in). */
  pushDefault: boolean;
  /** Writes an inbox row (always true except email-only events). */
  inbox: boolean;
  /** Pushed even when the owner chose "summary only". */
  summary: boolean;
  /** New-device alerts ignore quiet hours. */
  ignoreQuietHours: boolean;
  /** Staff reminders are only sent inside the person's shift +/- 2 h. */
  shiftWindowUserId: string | null;
  workDate: string | null;
}

const BASE: Plan = {
  audience: 'owner',
  permission: null,
  userIds: [],
  everyone: false,
  priority: 'normal',
  urgency: 'normal',
  ttlSec: ALERT_TTL_SEC,
  topic: null,
  batchable: false,
  pushDefault: true,
  inbox: true,
  summary: false,
  ignoreQuietHours: false,
  shiftWindowUserId: null,
  workDate: null,
};

const compact = (date: string) => date.replaceAll('-', '');
/** The random tail of a ULID: short, unique enough inside one org, safe in a Topic header. */
const shortId = (id: string) => id.slice(-8);

export function topicFor(prefix: string, userId: string, date: string): string {
  return `${prefix}-${shortId(userId)}-${compact(date)}`.slice(0, 32);
}

export function notInYetTopic(userId: string, date: string): string {
  return topicFor('notin', userId, date);
}

/** Static facts per event type: who it is for, which manager permission opens it, push default. */
export interface EventMeta {
  audience: Audience;
  permission: Permission | null;
  pushDefault: boolean;
}

const OWNER = (permission: Permission | null, pushDefault = true): EventMeta => ({
  audience: 'owner',
  permission,
  pushDefault,
});
const STAFF = (pushDefault = true): EventMeta => ({
  audience: 'staff',
  permission: null,
  pushDefault,
});

export const EVENT_META: Record<NotifyEventType, EventMeta> = {
  morning_summary: OWNER('approve_attendance'),
  late_checkin: OWNER('approve_attendance'),
  not_in_yet: OWNER('approve_attendance'),
  checkin_reminder: STAFF(),
  flagged_punch: OWNER('approve_attendance'),
  punch_needs_approval: OWNER('approve_attendance'),
  punch_decided: STAFF(),
  early_checkout: OWNER('approve_attendance', false),
  overtime_running: OWNER('approve_overtime'),
  checkout_reminder: STAFF(),
  missed_checkouts: OWNER('approve_attendance'),
  day_auto_closed: STAFF(),
  leave_requested: OWNER('approve_leave'),
  leave_decided: STAFF(),
  regularisation_requested: OWNER('approve_attendance', false),
  regularisation_decided: STAFF(),
  offsite_requested: OWNER('offsite'),
  duty_assigned: STAFF(),
  new_device: OWNER(null),
  device_decided: STAFF(),
  pin_attempts: OWNER(null),
  advance_recorded: STAFF(false),
  advance_requested: OWNER('payroll'),
  payroll_draft_ready: OWNER('payroll'),
  payslip_ready: STAFF(),
  salary_unpaid: OWNER('payroll'),
  schedule_changed: STAFF(),
  holiday_announced: STAFF(),
  needs_action_reminder: OWNER(null, false),
  weekly_digest: OWNER(null, false),
  sign_in_link: { audience: 'email', permission: null, pushDefault: false },
};

export function planFor(e: NotifyEvent): Plan {
  const meta = EVENT_META[e.type];
  const p = (over: Partial<Plan>): Plan => ({ ...BASE, ...meta, ...over });
  switch (e.type) {
    case 'morning_summary':
      return p({
        ttlSec: SUMMARY_TTL_SEC,
        summary: true,
        topic: `sum-${compact(e.date)}`,
        workDate: e.date,
      });
    case 'late_checkin':
      return p({
        priority: 'high',
        urgency: 'high',
        batchable: true,
        topic: topicFor('late', e.userId, e.workDate),
        workDate: e.workDate,
      });
    case 'not_in_yet':
      return p({
        priority: 'high',
        urgency: 'high',
        topic: notInYetTopic(e.userId, e.workDate),
        workDate: e.workDate,
      });
    case 'checkin_reminder':
      return p({
        userIds: [e.userId],
        topic: topicFor('cin', e.userId, e.workDate),
        shiftWindowUserId: e.userId,
        workDate: e.workDate,
      });
    case 'flagged_punch':
      return p({
        priority: 'high',
        urgency: 'high',
        batchable: true,
        topic: topicFor('flag', e.userId, istDate(e.effectiveTs)),
      });
    case 'punch_needs_approval':
      return p({ priority: 'high' });
    case 'punch_decided':
      return p({ userIds: [e.userId] });
    case 'early_checkout':
    case 'regularisation_requested':
      return p({ batchable: true });
    case 'overtime_running':
      return p({ topic: topicFor('ot', e.userId, e.workDate), workDate: e.workDate });
    case 'checkout_reminder':
      return p({
        userIds: [e.userId],
        topic: topicFor('cout', e.userId, e.workDate),
        shiftWindowUserId: e.userId,
        workDate: e.workDate,
      });
    case 'missed_checkouts':
      return p({
        priority: 'high',
        urgency: 'high',
        topic: `miss-${compact(e.workDate)}`,
        workDate: e.workDate,
      });
    case 'day_auto_closed':
      return p({
        userIds: [e.userId],
        topic: topicFor('auto', e.userId, e.workDate),
        workDate: e.workDate,
      });
    case 'leave_requested':
      return p({
        priority: e.urgent ? 'high' : 'normal',
        urgency: e.urgent ? 'high' : 'normal',
      });
    case 'leave_decided':
    case 'regularisation_decided':
    case 'device_decided':
    case 'advance_recorded':
      return p({ userIds: [e.userId] });
    case 'duty_assigned':
      return p({ userIds: e.userIds, workDate: e.workDate });
    case 'new_device':
      return p({ priority: 'high', urgency: 'high', ignoreQuietHours: true });
    case 'payslip_ready':
      return p({ userIds: e.userIds });
    case 'schedule_changed':
      return p({ userIds: [e.userId], workDate: e.date });
    case 'holiday_announced':
      return p({ everyone: true, workDate: e.date });
    case 'weekly_digest':
      return p({ ttlSec: SUMMARY_TTL_SEC });
    case 'sign_in_link':
      return p({ inbox: false });
    case 'offsite_requested':
    case 'pin_attempts':
    case 'advance_requested':
    case 'payroll_draft_ready':
    case 'salary_unpaid':
    case 'needs_action_reminder':
      return p({});
  }
}

// ---- Copy ----------------------------------------------------------------------------------

export interface Rendered {
  title: string;
  body: string | null;
  /** In-app path to open. */
  url: string;
  data: Record<string, unknown> | null;
}

export type T = (key: string, options?: Record<string, unknown>) => string;

export interface RenderCtx {
  t: T;
  lang: AppLang;
  /** The owner's display name in staff copy ("Urmi"). */
  owner: string;
}

const i18nCache = new Map<AppLang, Promise<Awaited<ReturnType<typeof createI18n>>>>();

export async function translator(lang: AppLang): Promise<T> {
  let p = i18nCache.get(lang);
  if (!p) {
    p = createI18n(lang);
    i18nCache.set(lang, p);
  }
  const i18n = await p;
  return (key, options) => i18n.t(`notify:${key}`, options ?? {}) as string;
}

/** `26–27 Oct` or `26 Oct`. */
export function dateRange(from: string, to: string, lang: AppLang): string {
  if (from === to) return formatDate(from, lang);
  const a = formatDate(from, lang);
  const b = formatDate(to, lang);
  const [ad, am] = a.split(' ');
  const [bd, bm] = b.split(' ');
  return am === bm ? `${ad}–${bd} ${bm}` : `${a}–${b}`;
}

function dutyWhen(rc: RenderCtx, date: string, now: number): string {
  const today = istDate(now);
  if (date === today) return rc.t('n.duty_assigned.today');
  const tomorrow = istDate(now + 86_400_000);
  if (date === tomorrow) return rc.t('n.duty_assigned.tomorrow');
  return rc.t('n.duty_assigned.on', { date: formatDate(date, rc.lang, 'weekday') });
}

export function render(e: NotifyEvent, rc: RenderCtx): Rendered {
  const { t } = rc;
  const hhmm = (ts: number) => istTime(ts);
  const lang = rc.lang;
  switch (e.type) {
    case 'morning_summary': {
      const lines = [
        t('n.morning_summary.body', {
          present: e.present,
          late: e.late,
          notInYet: e.notInYet,
          onLeave: e.onLeave,
        }),
      ];
      if (e.waitingOver48h > 0)
        lines.push(t('n.morning_summary.waiting', { count: e.waitingOver48h }));
      return {
        title: t('n.morning_summary.title', { time: hhmm(e.at) }),
        body: lines.join('\n'),
        url: '/o/today',
        data: { date: e.date },
      };
    }
    case 'late_checkin':
      return {
        title: t('n.late_checkin.title', { name: e.name, min: e.lateMin }),
        body: e.placeName
          ? t('n.late_checkin.bodyAt', { time: hhmm(e.inTs), place: e.placeName })
          : t('n.late_checkin.body', { time: hhmm(e.inTs) }),
        url: `/o/register/${e.userId}/${e.workDate}`,
        data: { userId: e.userId, name: e.name, lateMin: e.lateMin, workDate: e.workDate },
      };
    case 'not_in_yet':
      return {
        title: t('n.not_in_yet.title', { name: e.name }),
        body: t('n.not_in_yet.body', { shiftStart: e.shiftStart }),
        url: '/o/today',
        data: { userId: e.userId, workDate: e.workDate },
      };
    case 'checkin_reminder':
      return {
        title: t('n.checkin_reminder.title', { shiftStart: e.shiftStart }),
        body: t('n.checkin_reminder.body'),
        url: '/',
        data: { workDate: e.workDate },
      };
    case 'flagged_punch': {
      const reasons = e.reasons
        .map((r, i) => {
          const text = t(`n.flagged_punch.reason.${r}`);
          return i === 0 ? text : text.charAt(0).toLowerCase() + text.slice(1);
        })
        .join(' · ');
      return {
        title: t(e.kind === 'out' ? 'n.flagged_punch.titleOut' : 'n.flagged_punch.titleIn', {
          name: e.name,
        }),
        body: reasons || t('n.flagged_punch.bodyNone'),
        url: '/o/actions',
        data: { userId: e.userId, name: e.name, punchId: e.punchId },
      };
    }
    case 'punch_needs_approval': {
      let base = t('n.punch_needs_approval.bodyPlain');
      if (e.placeName)
        base =
          e.distanceM !== null
            ? t('n.punch_needs_approval.bodyDistance', {
                distance: e.distanceM,
                place: e.placeName,
              })
            : t('n.punch_needs_approval.bodyNoDistance', { place: e.placeName });
      return {
        title: t('n.punch_needs_approval.title', { name: e.name }),
        body: e.note ? t('n.punch_needs_approval.bodyNote', { base, note: e.note }) : base,
        url: '/o/actions',
        data: { userId: e.userId, punchId: e.punchId },
      };
    }
    case 'punch_decided': {
      const time = hhmm(e.effectiveTs);
      const kind = e.kind === 'out' ? 'Out' : 'In';
      const key = `n.punch_decided.${e.decision}${kind}`;
      return {
        title: t(key, { time, owner: rc.owner }),
        body: e.decision === 'rejected' ? e.note : null,
        url: `/day/${istDate(e.effectiveTs)}`,
        data: { punchId: e.punchId },
      };
    }
    case 'early_checkout':
      return {
        title: t('n.early_checkout.title', { name: e.name, time: hhmm(e.outTs) }),
        body: t('n.early_checkout.body', { duration: formatDuration(e.minutesEarly) }),
        url: `/o/register/${e.userId}/${istDate(e.outTs)}`,
        data: { userId: e.userId, name: e.name, outTs: e.outTs },
      };
    case 'overtime_running':
      return {
        title: t('n.overtime_running.title', { name: e.name }),
        body: t('n.overtime_running.body', { shiftEnd: e.shiftEnd }),
        url: '/o/actions',
        data: { userId: e.userId, workDate: e.workDate },
      };
    case 'checkout_reminder':
      return {
        title: t('n.checkout_reminder.title'),
        body: t('n.checkout_reminder.body'),
        url: '/',
        data: { workDate: e.workDate },
      };
    case 'missed_checkouts': {
      const first = e.people[0];
      return {
        title: t('n.missed_checkouts.title', {
          count: e.people.length,
          name: first?.name ?? '',
        }),
        body: t('n.missed_checkouts.body', { names: e.people.map((x) => x.name).join(', ') }),
        url: '/o/today',
        data: { workDate: e.workDate, userIds: e.people.map((x) => x.userId) },
      };
    }
    case 'day_auto_closed':
      return {
        title: t('n.day_auto_closed.title', { time: hhmm(e.outTs) }),
        body: t('n.day_auto_closed.body', { owner: rc.owner }),
        url: `/day/${e.workDate}`,
        data: { workDate: e.workDate },
      };
    case 'leave_requested': {
      const range = dateRange(e.fromDate, e.toDate, lang);
      const type = t(`n.leave_requested.type.${e.typeCode}`);
      return {
        title: t('n.leave_requested.title', { name: e.name }),
        body: e.reason
          ? t('n.leave_requested.bodyReason', { range, type, reason: e.reason })
          : t('n.leave_requested.body', { range, type }),
        url: '/o/actions',
        data: { userId: e.userId, requestId: e.requestId },
      };
    }
    case 'leave_decided':
      return {
        title: t(`n.leave_decided.${e.decision}`, {
          range: dateRange(e.fromDate, e.toDate, lang),
        }),
        body: e.decision === 'rejected' ? e.note : null,
        url: '/requests',
        data: { requestId: e.requestId },
      };
    case 'regularisation_requested': {
      const time = e.proposedOutTs ?? e.proposedInTs;
      return {
        title: t('n.regularisation_requested.title', {
          name: e.name,
          date: formatDate(e.workDate, lang),
        }),
        body: t(`n.regularisation_requested.${e.kind}`, { time: time ? hhmm(time) : '' }),
        url: '/o/actions',
        data: { userId: e.userId, name: e.name, requestId: e.requestId, workDate: e.workDate },
      };
    }
    case 'regularisation_decided':
      return {
        title: t(`n.regularisation_decided.${e.decision}`, { date: formatDate(e.workDate, lang) }),
        body: e.decision === 'rejected' ? e.note : null,
        url: '/requests',
        data: { requestId: e.requestId },
      };
    case 'offsite_requested':
      return {
        title: t('n.offsite_requested.title', { name: e.name }),
        body: t('n.offsite_requested.body', { place: e.placeName }),
        url: '/o/actions',
        data: { userId: e.userId, punchId: e.punchId },
      };
    case 'duty_assigned': {
      const when = dutyWhen(rc, e.workDate, e.at);
      if (e.change === 'cancelled')
        return {
          title: t('n.duty_assigned.titleCancelled'),
          body: t('n.duty_assigned.bodyCancelled', { when, place: e.placeName }),
          url: '/',
          data: { dutyId: e.dutyId },
        };
      return {
        title: t('n.duty_assigned.title', {
          when,
          start: hhmm(e.startTs),
          end: hhmm(e.endTs),
        }),
        body: t('n.duty_assigned.body', { place: e.placeName }),
        url: '/',
        data: { dutyId: e.dutyId, change: e.change },
      };
    }
    case 'new_device':
      return {
        title: t('n.new_device.title', { name: e.name }),
        body: t('n.new_device.body'),
        url: '/o/actions',
        data: { userId: e.userId, deviceId: e.deviceId, label: e.deviceLabel },
      };
    case 'device_decided':
      return {
        title: t(`n.device_decided.${e.decision}Title`),
        body: t(`n.device_decided.${e.decision}Body`, { owner: rc.owner }),
        url: '/',
        data: { deviceId: e.deviceId },
      };
    case 'pin_attempts':
      return {
        title: t('n.pin_attempts.title', { name: e.name }),
        body: t('n.pin_attempts.body', { count: e.count }),
        url: `/o/staff/${e.userId}`,
        data: { userId: e.userId },
      };
    case 'advance_recorded':
      return {
        title: t('n.advance_recorded.title', {
          owner: rc.owner,
          amount: formatRupees(e.amountPaise, { whole: true }),
        }),
        body: t('n.advance_recorded.body', { summary: e.recoverySummary }),
        url: '/requests',
        data: { advanceId: e.advanceId },
      };
    case 'advance_requested':
      return {
        title: t('n.advance_requested.title', { name: e.name }),
        body: t('n.advance_requested.body', {
          amount: formatRupees(e.amountPaise, { whole: true }),
          reason: e.reason,
        }),
        url: '/o/advances',
        data: { userId: e.userId, advanceId: e.advanceId },
      };
    case 'payroll_draft_ready':
      return {
        title: t('n.payroll_draft_ready.title', { month: monthName(e.month, lang) }),
        body:
          e.blockersCount === 0
            ? t('n.payroll_draft_ready.bodyNone')
            : t('n.payroll_draft_ready.body', { count: e.blockersCount }),
        url: `/o/payroll/${e.runId}`,
        data: { runId: e.runId, month: e.month },
      };
    case 'payslip_ready':
      return {
        title: t('n.payslip_ready.title', { month: monthName(e.month, lang) }),
        body: null,
        url: '/payslips',
        data: { runId: e.runId, month: e.month },
      };
    case 'salary_unpaid':
      return {
        title: t('n.salary_unpaid.title', {
          count: e.unpaidCount,
          month: monthName(e.month, lang),
        }),
        body: t('n.salary_unpaid.body'),
        url: `/o/payroll/${e.runId}`,
        data: { runId: e.runId, month: e.month },
      };
    case 'schedule_changed':
      return { title: e.summary, body: null, url: '/month', data: { date: e.date } };
    case 'holiday_announced':
      return {
        title: t('n.holiday_announced.title', { date: formatDate(e.date, lang), name: e.name }),
        body: null,
        url: '/month',
        data: { date: e.date },
      };
    case 'needs_action_reminder':
      return {
        title: t('n.needs_action_reminder.title', { count: e.count }),
        body: t('n.needs_action_reminder.body'),
        url: '/o/actions',
        data: { count: e.count },
      };
    case 'weekly_digest':
      return {
        title: t('n.weekly_digest.title', {
          onTime: Math.round(e.onTimePct),
          overtime: hoursText(e.otApprovedMin),
          leaves: e.leaves,
        }),
        body: t('n.weekly_digest.body', { week: formatDate(e.weekStart, lang) }),
        url: '/o/today',
        data: { weekStart: e.weekStart },
      };
    case 'sign_in_link':
      return {
        title: t('email.signin.subject', { code: e.code }),
        body: null,
        url: '/',
        data: null,
      };
  }
}

/** `6 h` or `6 h 30 m` (the digest copy drops empty minutes). */
function hoursText(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} h` : h === 0 ? `${m} m` : `${h} h ${m} m`;
}

/** `October` from `2026-10` (month name only, as the PRD copy has it). */
function monthName(month: string, lang: AppLang): string {
  return formatMonth(month, lang).split(' ')[0] ?? month;
}

// ---- Batching copy ---------------------------------------------------------------------------

export interface BatchItem {
  title: string;
  data: Record<string, unknown> | null;
}

/** Copy for one push that replaces several same-type alerts ("2 people are late: Priya 18 m, Kajal 12 m"). */
export function renderMerged(
  type: NotifyEventType,
  items: BatchItem[],
  rc: RenderCtx,
): { title: string; body: string } | null {
  const { t } = rc;
  const count = items.length;
  const d = (i: BatchItem) => i.data ?? {};
  switch (type) {
    case 'late_checkin':
      return {
        title: t('n.late_checkin.merged_title', { count }),
        body: items
          .map((i) => t('n.late_checkin.merged_item', { name: d(i).name, min: d(i).lateMin }))
          .join(', '),
      };
    case 'flagged_punch':
      return {
        title: t('n.flagged_punch.merged_title', { count }),
        body: items.map((i) => String(d(i).name ?? '')).join(', '),
      };
    case 'early_checkout':
      return {
        title: t('n.early_checkout.merged_title', { count }),
        body: items
          .map((i) =>
            t('n.early_checkout.merged_item', {
              name: d(i).name,
              time: istTime(Number(d(i).outTs ?? 0)),
            }),
          )
          .join(', '),
      };
    case 'regularisation_requested':
      return {
        title: t('n.regularisation_requested.merged_title', { count }),
        body: items
          .map((i) =>
            t('n.regularisation_requested.merged_item', {
              name: d(i).name,
              date: formatDate(String(d(i).workDate ?? ''), rc.lang),
            }),
          )
          .join(', '),
      };
    default:
      return null;
  }
}
