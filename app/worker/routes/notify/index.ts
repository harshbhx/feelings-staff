/** Route handlers. Owner: WP-8: notifications, push subscriptions, preferences. */
import {
  NOTIFY_EVENT_NUMBER,
  type NotificationPrefs,
  type NotificationView,
  type NotifyEventType,
  SECURITY_EVENTS,
} from '@fs/contracts';
import { json } from '../../db';
import type { Handlers } from '../../lib/api';
import { fail } from '../../lib/errors';
import { ulid } from '../../lib/ulid';
import { EMAIL_DEFAULT_ON } from '../../services/notifier';
import { EVENT_META } from '../../services/notifier-plan';
import type { Ctx } from '../../services/ports';

const PAGE_SIZE = 30;
const MAX_SUBSCRIPTIONS_PER_USER = 5;
/** D1 allows 100 bound parameters per statement. */
const IDS_PER_STATEMENT = 90;

interface Row {
  id: string;
  type: NotifyEventType;
  title: string;
  body: string | null;
  url: string;
  priority: 'high' | 'normal';
  data_json: string | null;
  read_at: number | null;
  created_at: number;
}

function me(ctx: Ctx): string {
  if (!ctx.user) fail('UNAUTHENTICATED');
  return ctx.user.id;
}

function encodeCursor(row: Row): string {
  return `${row.created_at}.${row.id}`;
}

function decodeCursor(cursor: string): { at: number; id: string } {
  const dot = cursor.indexOf('.');
  const at = Number(cursor.slice(0, dot));
  if (dot < 1 || !Number.isFinite(at)) fail('BAD_REQUEST', 'That page marker is not valid.');
  return { at, id: cursor.slice(dot + 1) };
}

function view(r: Row): NotificationView {
  return {
    id: r.id,
    type: r.type,
    title: r.title,
    body: r.body,
    url: r.url,
    priority: r.priority,
    data: json<Record<string, unknown> | null>(r.data_json, null),
    readAt: r.read_at,
    createdAt: r.created_at,
  };
}

/** The events this person can receive, with their current switches. */
async function loadPrefs(ctx: Ctx): Promise<NotificationPrefs> {
  const userId = me(ctx);
  const isOwnerSide = ctx.user?.role !== 'staff';
  const saved = await ctx.db.all<{
    event_type: string;
    push: number;
    whatsapp: number;
    email: number;
  }>('SELECT event_type, push, whatsapp, email FROM notification_prefs WHERE user_id = ?', userId);
  const byType = new Map(saved.map((r) => [r.event_type, r]));
  const types = (Object.keys(EVENT_META) as NotifyEventType[])
    .filter((t) => {
      const m = EVENT_META[t];
      if (m.audience === 'email') return false;
      return isOwnerSide ? m.audience === 'owner' : m.audience === 'staff';
    })
    .sort((a, b) => NOTIFY_EVENT_NUMBER[a] - NOTIFY_EVENT_NUMBER[b]);
  return {
    events: types.map((type) => {
      const locked = SECURITY_EVENTS.includes(type);
      const row = byType.get(type);
      return {
        type,
        push: locked ? true : row ? row.push === 1 : EVENT_META[type].pushDefault,
        whatsapp: row ? row.whatsapp === 1 : false,
        email: row ? row.email === 1 : EMAIL_DEFAULT_ON.includes(type),
        locked,
      };
    }),
  };
}

export const handlers: Handlers = {
  async notificationsList({ query }, ctx) {
    const userId = me(ctx);
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const rows = await ctx.db.all<Row>(
      `SELECT id, type, title, body, url, priority, data_json, read_at, created_at
         FROM notifications
        WHERE org_id = ?org AND user_id = ?
          AND (? IS NULL OR created_at < ? OR (created_at = ? AND id < ?))
        ORDER BY created_at DESC, id DESC LIMIT ?`,
      userId,
      cursor?.at ?? null,
      cursor?.at ?? null,
      cursor?.at ?? null,
      cursor?.id ?? '',
      PAGE_SIZE + 1,
    );
    const page = rows.slice(0, PAGE_SIZE);
    const last = page[page.length - 1];
    const unread = await ctx.db.first<{ n: number }>(
      'SELECT COUNT(*) AS n FROM notifications WHERE org_id = ?org AND user_id = ? AND read_at IS NULL',
      userId,
    );
    return {
      items: page.map(view),
      nextCursor: rows.length > PAGE_SIZE && last ? encodeCursor(last) : null,
      unread: unread?.n ?? 0,
    };
  },

  async notificationsRead({ body }, ctx) {
    const userId = me(ctx);
    const now = ctx.now();
    if ('all' in body) {
      await ctx.db.run(
        'UPDATE notifications SET read_at = ? WHERE org_id = ?org AND user_id = ? AND read_at IS NULL',
        now,
        userId,
      );
      return undefined;
    }
    const stmts: D1PreparedStatement[] = [];
    for (let i = 0; i < body.ids.length; i += IDS_PER_STATEMENT) {
      const ids = body.ids.slice(i, i + IDS_PER_STATEMENT);
      stmts.push(
        ctx.db.stmt(
          `UPDATE notifications SET read_at = ?
            WHERE org_id = ?org AND user_id = ? AND read_at IS NULL AND id IN (${ids.map(() => '?').join(', ')})`,
          now,
          userId,
          ...ids,
        ),
      );
    }
    await ctx.db.batch(stmts);
    return undefined;
  },

  async notificationOpened({ params }, ctx) {
    await ctx.db.run(
      `UPDATE notifications SET opened_at = COALESCE(opened_at, ?), read_at = COALESCE(read_at, ?)
        WHERE org_id = ?org AND user_id = ? AND id = ?`,
      ctx.now(),
      ctx.now(),
      me(ctx),
      params.id,
    );
    return undefined;
  },

  async pushSubscribe({ body }, ctx) {
    const userId = me(ctx);
    const now = ctx.now();
    const existing = await ctx.db.all<{ id: string; endpoint: string }>(
      'SELECT id, endpoint FROM push_subscriptions WHERE org_id = ?org AND user_id = ? ORDER BY created_at DESC, id DESC',
      userId,
    );
    // Keep the newest few phones; a re-subscribe of the same endpoint replaces its row below.
    const others = existing.filter((s) => s.endpoint !== body.endpoint);
    const drop = others.slice(MAX_SUBSCRIPTIONS_PER_USER - 1);
    await ctx.db.batch([
      ...drop.map((s) =>
        ctx.db.stmt('DELETE FROM push_subscriptions WHERE org_id = ?org AND id = ?', s.id),
      ),
      ctx.db.stmt(
        `INSERT INTO push_subscriptions
           (id, org_id, user_id, device_id, endpoint, p256dh, auth, platform, created_at, failures)
         VALUES (?, ?org, ?, ?, ?, ?, ?, ?, ?, 0)
         ON CONFLICT(endpoint) DO UPDATE SET
           user_id = excluded.user_id, device_id = excluded.device_id, p256dh = excluded.p256dh,
           auth = excluded.auth, platform = excluded.platform, failures = 0`,
        ulid(now),
        userId,
        ctx.session?.deviceId ?? null,
        body.endpoint,
        body.keys.p256dh,
        body.keys.auth,
        body.platform,
        now,
      ),
      ctx.services.audit.stmt(ctx, {
        category: 'change',
        action: 'push.subscribe',
        entity: 'push_subscription',
        entityId: userId,
        after: { platform: body.platform },
      }),
    ]);
    return undefined;
  },

  async pushUnsubscribe({ body }, ctx) {
    await ctx.db.batch([
      ctx.db.stmt(
        'DELETE FROM push_subscriptions WHERE org_id = ?org AND user_id = ? AND endpoint = ?',
        me(ctx),
        body.endpoint,
      ),
      ctx.services.audit.stmt(ctx, {
        category: 'change',
        action: 'push.unsubscribe',
        entity: 'push_subscription',
        entityId: me(ctx),
      }),
    ]);
    return undefined;
  },

  async notificationPrefsGet(_input, ctx) {
    return loadPrefs(ctx);
  },

  async notificationPrefsPut({ body }, ctx) {
    const userId = me(ctx);
    const allowed = new Set((await loadPrefs(ctx)).events.map((e) => e.type));
    const before = await loadPrefs(ctx);
    const stmts: D1PreparedStatement[] = [];
    for (const ev of body.events) {
      if (!allowed.has(ev.type)) continue;
      const locked = SECURITY_EVENTS.includes(ev.type);
      stmts.push(
        ctx.db.stmt(
          `INSERT OR REPLACE INTO notification_prefs (user_id, event_type, push, whatsapp, email)
           VALUES (?, ?, ?, ?, ?)`,
          userId,
          ev.type,
          locked || ev.push ? 1 : 0,
          ev.whatsapp ? 1 : 0,
          ev.email ? 1 : 0,
        ),
      );
    }
    await ctx.db.batch([
      ...stmts,
      ctx.services.audit.stmt(ctx, {
        category: 'change',
        action: 'notification_prefs.update',
        entity: 'notification_prefs',
        entityId: userId,
        before: before.events.filter((e) => !e.locked).map((e) => [e.type, e.push]),
        after: body.events.filter((e) => allowed.has(e.type)).map((e) => [e.type, e.push]),
      }),
    ]);
    return loadPrefs(ctx);
  },
};
