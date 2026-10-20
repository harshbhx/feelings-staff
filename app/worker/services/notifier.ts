/**
 * Notifier (PRD 6): recipients, preferences, the inbox row, push payloads, batching, topics, quiet
 * hours and failed-push handling. Owner: WP-8.
 *
 * Every event writes an inbox row per recipient (the source of truth). Pushes follow the matrix in
 * `notifier-plan.ts`. Producers call `ctx.services.notifier.emit` after their own transaction; a
 * failure here is logged and never undoes the thing that happened.
 */
import {
  formatDuration,
  hhmmToMin,
  istDate,
  istTime,
  type NotifyEvent,
  type NotifyEventType,
  type PushPayload,
  SECURITY_EVENTS,
} from '@fs/contracts';
import type { AppLang } from '@fs/i18n';
import { json } from '../db';
import { isNonProd } from '../env';
import { loadOrg } from '../lib/settings';
import { ulid } from '../lib/ulid';
import { weeklyDigest } from './digest';
import { noticeEmail, signInEmail } from './email-templates';
import {
  type BatchItem,
  notInYetTopic,
  type Plan,
  planFor,
  type RenderCtx,
  type Rendered,
  render,
  renderMerged,
  translator,
} from './notifier-plan';
import { inReminderWindow, loadPersonDays } from './notifier-schedule';
import type { Ctx, Notifier, PushOpts, PushOutcome, PushSub } from './ports';

export const BATCH_WINDOW_MS = 5 * 60_000;
export const PUSH_LIMIT_BYTES = 2048;
/** Longest we wait for a 429 `Retry-After` inside one request. */
const MAX_RETRY_WAIT_MS = 5000;

export interface Recipient {
  id: string;
  role: 'owner' | 'manager' | 'staff';
  name: string;
  lang: AppLang;
  email: string | null;
}

interface UserRow {
  id: string;
  role: 'owner' | 'manager' | 'staff';
  name: string;
  lang: AppLang;
  email: string | null;
  permissions_json: string | null;
}

interface SubRow extends PushSub {
  id: string;
}

interface NotificationRow {
  id: string;
  title: string;
  data_json: string | null;
  topic: string | null;
  push_status: string;
}

// ---- Quiet hours -------------------------------------------------------------------------------

/** True when `at` is inside quiet hours (they may wrap past midnight, e.g. 21:30 to 08:00). */
export function inQuietHours(at: number, start: string, end: string): boolean {
  const t = hhmmToMin(istTime(at));
  const s = hhmmToMin(start);
  const e = hhmmToMin(end);
  if (s === e) return false;
  return s < e ? t >= s && t < e : t >= s || t < e;
}

// ---- Payloads ----------------------------------------------------------------------------------

const langTag = (lang: AppLang) => (lang === 'gu' ? 'gu-IN' : 'en-IN');
const byteLength = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;

export interface PayloadInput {
  type: NotifyEventType;
  id: string;
  title: string;
  body: string | null;
  /** In-app path. */
  url: string;
  lang: AppLang;
  topic: string | null;
  badge: number;
}

/** Declarative Web Push payload, at most 2 KB (the body is shortened until it fits). */
export function buildPayload(env: { APP_ORIGIN: string }, i: PayloadInput): PushPayload {
  const navigate = env.APP_ORIGIN ? new URL(i.url, env.APP_ORIGIN).toString() : i.url;
  const make = (body: string | null): PushPayload => ({
    web_push: 8030,
    notification: {
      title: i.title,
      ...(body ? { body } : {}),
      navigate,
      lang: langTag(i.lang),
      app_badge: String(i.badge),
    },
    t: i.type,
    e: i.id,
    ...(i.topic ? { topic: i.topic } : {}),
    badge: i.badge,
  });
  let body = i.body;
  let payload = make(body);
  while (body && byteLength(payload) > PUSH_LIMIT_BYTES) {
    body = body.length > 40 ? `${body.slice(0, Math.floor(body.length * 0.8)).trimEnd()}…` : null;
    payload = make(body);
  }
  return payload;
}

/** The shorter payload sent after a 413: title only. */
export function shortenPayload(p: PushPayload): PushPayload {
  const { body: _body, ...rest } = p.notification;
  return { ...p, notification: { ...rest, title: p.notification.title.slice(0, 80) } };
}

// ---- Recipients --------------------------------------------------------------------------------

export async function resolveRecipients(ctx: Ctx, plan: Plan): Promise<Recipient[]> {
  if (plan.audience === 'email') return [];
  let rows: UserRow[];
  if (plan.audience === 'owner') {
    rows = await ctx.db.all<UserRow>(
      `SELECT id, role, name, lang, email, permissions_json FROM users
        WHERE org_id = ?org AND status = 'active' AND role IN ('owner', 'manager')`,
    );
    rows = rows.filter((u) => {
      if (u.role === 'owner') return true;
      if (!plan.permission) return false;
      return json<string[]>(u.permissions_json, []).includes(plan.permission);
    });
  } else if (plan.everyone) {
    rows = await ctx.db.all<UserRow>(
      `SELECT id, role, name, lang, email, permissions_json FROM users
        WHERE org_id = ?org AND status = 'active' AND role IN ('staff', 'manager')`,
    );
  } else {
    const ids = [...new Set(plan.userIds)];
    if (ids.length === 0) return [];
    rows = await ctx.db.all<UserRow>(
      `SELECT id, role, name, lang, email, permissions_json FROM users
        WHERE org_id = ?org AND status IN ('active', 'invited') AND id IN (${ids.map(() => '?').join(', ')})`,
      ...ids,
    );
  }
  return rows.map((u) => ({
    id: u.id,
    role: u.role,
    name: u.name,
    lang: u.lang === 'gu' ? 'gu' : 'en',
    email: u.email,
  }));
}

// ---- Sending -----------------------------------------------------------------------------------

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function sendOne(
  ctx: Ctx,
  sub: SubRow,
  payload: PushPayload,
  opts: PushOpts,
): Promise<PushOutcome> {
  const send = (p: PushPayload) => ctx.services.push.send(sub, p, opts);
  let out = await send(payload);
  if (!out.ok && out.status === 413) {
    console.warn(JSON.stringify({ msg: 'push.413', requestId: ctx.requestId }));
    out = await send(shortenPayload(payload));
  }
  if (!out.ok && out.status === 429) {
    await sleep(Math.min((out.retryAfterSec ?? 1) * 1000, MAX_RETRY_WAIT_MS));
    out = await send(payload);
  }
  if (out.ok) {
    await ctx.db.run(
      'UPDATE push_subscriptions SET last_success_at = ?, failures = 0 WHERE org_id = ?org AND id = ?',
      ctx.now(),
      sub.id,
    );
  } else if (out.gone) {
    await ctx.db.run('DELETE FROM push_subscriptions WHERE org_id = ?org AND id = ?', sub.id);
  } else {
    await ctx.db.run(
      'UPDATE push_subscriptions SET failures = failures + 1 WHERE org_id = ?org AND id = ?',
      sub.id,
    );
  }
  return out;
}

/** Push to every subscription of one person. Returns true when at least one went out. */
export async function pushToUser(
  ctx: Ctx,
  userId: string,
  payload: PushPayload,
  opts: PushOpts,
): Promise<boolean> {
  const subs = await ctx.db.all<SubRow>(
    'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE org_id = ?org AND user_id = ?',
    userId,
  );
  if (subs.length === 0) return false;
  if (isNonProd(ctx.env)) await ctx.services.outbox.record(ctx, 'push', userId, { payload, opts });
  const results = await Promise.allSettled(subs.map((s) => sendOne(ctx, s, payload, opts)));
  return results.some((r) => r.status === 'fulfilled' && r.value.ok);
}

async function unreadCount(ctx: Ctx, userId: string): Promise<number> {
  const row = await ctx.db.first<{ n: number }>(
    'SELECT COUNT(*) AS n FROM notifications WHERE org_id = ?org AND user_id = ? AND read_at IS NULL',
    userId,
  );
  return row?.n ?? 0;
}

// ---- Held notifications (quiet hours) ------------------------------------------------------------

/**
 * Deliver what quiet hours held as one summary push per person ("3 alerts while you were away").
 * Called by the rules job once quiet hours end. Returns the number of people notified.
 */
export async function releaseHeld(ctx: Ctx): Promise<number> {
  const held = await ctx.db.all<
    NotificationRow & { user_id: string; type: NotifyEventType; url: string }
  >(
    `SELECT id, user_id, type, title, url, data_json, topic, push_status FROM notifications
      WHERE org_id = ?org AND push_status = 'held' ORDER BY created_at, id`,
  );
  const byUser = new Map<string, typeof held>();
  for (const n of held) byUser.set(n.user_id, [...(byUser.get(n.user_id) ?? []), n]);
  let people = 0;
  for (const [userId, rows] of byUser) {
    const user = await ctx.db.first<{ lang: AppLang }>(
      'SELECT lang FROM users WHERE org_id = ?org AND id = ?',
      userId,
    );
    const lang: AppLang = user?.lang === 'gu' ? 'gu' : 'en';
    const t = await translator(lang);
    const last = rows[rows.length - 1];
    if (!last) continue;
    const shown = rows.slice(-3).map((r) => r.title);
    const extra = rows.length - shown.length;
    const body = [
      ...shown,
      ...(extra > 0 ? [t('n.held_summary.more', { count: extra })] : []),
    ].join('\n');
    const payload = buildPayload(ctx.env, {
      type: last.type,
      id: last.id,
      title: t('n.held_summary.title', { count: rows.length }),
      body,
      url: rows.length === 1 ? last.url : userRoleInbox(rows),
      lang,
      topic: `held-${istDate(ctx.now()).replaceAll('-', '')}`,
      badge: await unreadCount(ctx, userId),
    });
    const ok = await pushToUser(ctx, userId, payload, {
      ttlSec: 12 * 3600,
      urgency: 'normal',
      topic: payload.topic ?? 'held',
    });
    const now = ctx.now();
    await ctx.db.run(
      `UPDATE notifications SET push_status = ?, push_sent_at = ?
        WHERE org_id = ?org AND user_id = ? AND push_status = 'held'`,
      ok ? 'sent' : 'failed',
      now,
      userId,
    );
    if (ok) people += 1;
  }
  return people;
}

function userRoleInbox(rows: { url: string }[]): string {
  return rows.some((r) => r.url.startsWith('/o')) ? '/o/inbox' : '/inbox';
}

// ---- The Notifier ------------------------------------------------------------------------------

interface Prefs {
  push: boolean;
  email: boolean;
}

/**
 * Email is on by default for the owner's N24 and N30 (PRD 6). The staff payslip email (N25) is
 * opt-in: the PRD lists in-app and push for it, so email only goes to people who switch it on.
 */
export const EMAIL_DEFAULT_ON: NotifyEventType[] = ['payroll_draft_ready', 'weekly_digest'];
const EMAIL_TYPES: NotifyEventType[] = ['payroll_draft_ready', 'payslip_ready', 'weekly_digest'];

async function emailLines(
  ctx: Ctx,
  e: NotifyEvent,
  t: Awaited<ReturnType<typeof translator>>,
): Promise<string[]> {
  if (e.type !== 'weekly_digest') return [];
  const d = await weeklyDigest(ctx, e.weekStart);
  const lines = [
    t('email.digest.late', { count: d.late }),
    t('email.digest.absent', { count: d.absent }),
    t('email.digest.overtime', { time: formatDuration(d.otApprovedMin) }),
    t('email.digest.pending', { count: d.pending }),
  ];
  if (d.credits?.length) {
    lines.push(t('email.digest.creditsHeading'));
    for (const c of d.credits) {
      const sign = c.balanceMin < 0 ? '-' : '+';
      lines.push(
        t('email.digest.credit', {
          name: c.name,
          balance: `${sign}${formatDuration(Math.abs(c.balanceMin))}`,
        }),
      );
    }
  }
  return lines;
}

async function prefsFor(
  ctx: Ctx,
  userId: string,
  type: NotifyEventType,
  plan: Plan,
): Promise<Prefs> {
  const row = await ctx.db.first<{ push: number; email: number }>(
    'SELECT push, email FROM notification_prefs WHERE user_id = ? AND event_type = ?',
    userId,
    type,
  );
  const locked = SECURITY_EVENTS.includes(type);
  return {
    push: locked ? true : row ? row.push === 1 : plan.pushDefault,
    email: row ? row.email === 1 : EMAIL_DEFAULT_ON.includes(type),
  };
}

async function notifyRecipient(
  ctx: Ctx,
  e: NotifyEvent,
  plan: Plan,
  who: Recipient,
  ownerName: string,
  quiet: { enabled: boolean; start: string; end: string; summaryOnly: boolean },
): Promise<void> {
  const now = ctx.now();

  if (plan.shiftWindowUserId && plan.workDate) {
    const [day] = await loadPersonDays(ctx, plan.workDate, [plan.shiftWindowUserId]);
    if (!day || !inReminderWindow(day, e.at)) {
      console.info(JSON.stringify({ msg: 'notify.outside_shift_window', type: e.type }));
      return;
    }
  }

  const t = await translator(who.lang);
  const rc: RenderCtx = { t, lang: who.lang, owner: ownerName };
  const view: Rendered = render(e, rc);
  const prefs = await prefsFor(ctx, who.id, e.type, plan);
  const isOwnerSide = plan.audience === 'owner';
  const security = SECURITY_EVENTS.includes(e.type);

  // Push decision: on, held for quiet hours, or off.
  let status: 'none' | 'held' | 'queued' = 'none';
  if (prefs.push) {
    const mutedBySummaryOnly = isOwnerSide && quiet.summaryOnly && !plan.summary && !security;
    if (!mutedBySummaryOnly) {
      const inQuiet =
        isOwnerSide &&
        !plan.ignoreQuietHours &&
        quiet.enabled &&
        inQuietHours(now, quiet.start, quiet.end);
      status = inQuiet ? 'held' : 'queued';
    }
  }
  if (status === 'queued') {
    const subs = await ctx.db.first<{ n: number }>(
      'SELECT COUNT(*) AS n FROM push_subscriptions WHERE org_id = ?org AND user_id = ?',
      who.id,
    );
    if (!subs?.n) status = 'none';
  }

  // Topic: a late arrival replaces the not-in-yet alert already pushed for the same person and day.
  let topic = plan.topic;
  if (e.type === 'late_checkin') {
    const earlier = await ctx.db.first<{ id: string }>(
      `SELECT id FROM notifications WHERE org_id = ?org AND user_id = ? AND topic = ?
         AND push_status = 'sent' LIMIT 1`,
      who.id,
      notInYetTopic(e.userId, e.workDate),
    );
    if (earlier) topic = notInYetTopic(e.userId, e.workDate);
  }

  const batchKey = plan.batchable ? `${e.type}|${istDate(now)}` : null;
  const id = ulid(now);
  await ctx.db
    .insert('notifications', {
      id,
      user_id: who.id,
      type: e.type,
      title: view.title,
      body: view.body,
      url: view.url,
      data_json: view.data ? JSON.stringify(view.data) : null,
      priority: plan.priority,
      topic,
      batch_key: batchKey,
      push_status: status,
      created_at: now,
    })
    .run();

  if (status === 'queued') {
    let title = view.title;
    let body = view.body;
    let sendTopic = topic;
    let url = view.url;
    if (batchKey) {
      const recent = await ctx.db.all<NotificationRow>(
        `SELECT id, title, data_json, topic, push_status FROM notifications
          WHERE org_id = ?org AND user_id = ? AND batch_key = ? AND created_at >= ? AND id <> ?
          ORDER BY created_at, id`,
        who.id,
        batchKey,
        now - BATCH_WINDOW_MS,
        id,
      );
      const leader = recent.find((r) => r.push_status === 'sent');
      if (leader) {
        const parse = (r: { title: string; data_json: string | null }): BatchItem => ({
          title: r.title,
          data: json<Record<string, unknown> | null>(r.data_json, null),
        });
        const items = [
          ...recent.map(parse),
          { title: view.title, data: view.data } satisfies BatchItem,
        ];
        const merged = renderMerged(e.type, items, rc);
        if (merged) {
          title = merged.title;
          body = merged.body;
          // Same topic as the first push, so the device shows one merged notification.
          sendTopic = leader.topic ?? topic;
          url =
            e.type === 'late_checkin' || e.type === 'early_checkout' ? '/o/today' : '/o/actions';
        }
      }
    }
    const payload = buildPayload(ctx.env, {
      type: e.type,
      id,
      title,
      body,
      url,
      lang: who.lang,
      topic: sendTopic,
      badge: await unreadCount(ctx, who.id),
    });
    const deliver = async () => {
      let ok = false;
      try {
        ok = await pushToUser(ctx, who.id, payload, {
          ttlSec: plan.ttlSec,
          urgency: plan.urgency,
          ...(sendTopic ? { topic: sendTopic } : {}),
        });
      } catch (err) {
        console.error(
          JSON.stringify({ msg: 'notify.push_error', type: e.type, error: String(err) }),
        );
      }
      await ctx.db.run(
        'UPDATE notifications SET push_status = ?, push_sent_at = ? WHERE org_id = ?org AND id = ?',
        ok ? 'sent' : 'failed',
        ctx.now(),
        id,
      );
    };
    if (isNonProd(ctx.env)) await deliver();
    else ctx.waitUntil(deliver());
  }

  if (EMAIL_TYPES.includes(e.type) && prefs.email && who.email) {
    let status = 'sent';
    try {
      const msg = noticeEmail(t, who.email, {
        title: view.title,
        body: view.body,
        lines: await emailLines(ctx, e, t),
        url: `${ctx.env.APP_ORIGIN}${view.url}`,
        footer: t(e.type === 'weekly_digest' ? 'email.digest.footer' : 'email.notice.footer'),
      });
      await ctx.services.email.send(ctx, msg);
    } catch (err) {
      status = 'failed';
      console.error(
        JSON.stringify({ msg: 'notify.email_error', type: e.type, error: String(err) }),
      );
    }
    await ctx.db.run(
      'UPDATE notifications SET email_status = ? WHERE org_id = ?org AND id = ?',
      status,
      id,
    );
  }
}

export function createNotifier(): Notifier {
  return {
    async emit(ctx, e) {
      try {
        const plan = planFor(e);
        if (e.type === 'sign_in_link') {
          const t = await translator('en');
          await ctx.services.email.send(ctx, signInEmail(t, e.email, e.url, e.code));
          return;
        }
        const people = await resolveRecipients(ctx, plan);
        if (people.length === 0) return;
        const { org, settings } = await loadOrg(ctx);
        const q = settings.notifications;
        const quiet = { ...q.quietHours, summaryOnly: q.summaryOnly };
        for (const who of people) {
          try {
            await notifyRecipient(ctx, e, plan, who, org.owner_display_name, quiet);
          } catch (err) {
            console.error(
              JSON.stringify({ msg: 'notify.recipient_error', type: e.type, error: String(err) }),
            );
          }
        }
      } catch (err) {
        // Never include the event body: sign-in codes must stay out of logs.
        console.error(
          JSON.stringify({
            msg: 'notify.error',
            type: e.type,
            requestId: ctx.requestId,
            error: String(err),
          }),
        );
      }
    },
  };
}
