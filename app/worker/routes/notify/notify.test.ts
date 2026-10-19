/** Notification endpoints (PRD 9.4): inbox, read state, push subscriptions, preferences. Covers S-15. */
import { describe, expect, it } from 'vitest';
import { callJson, sessionFor, testEnv } from '../../test/helpers';
import { addUser, emitAt, ist, newSalon, subscribe } from '../../test/notify-kit';

interface Page {
  items: { id: string; title: string; readAt: number | null }[];
  nextCursor: string | null;
  unread: number;
}

async function setup() {
  const salon = await newSalon();
  const priya = await addUser(salon, { name: 'Priya' });
  const owner = await sessionFor(salon.ownerId);
  const staff = await sessionFor(priya);
  return { salon, priya, owner, staff };
}

async function notify(salon: Awaited<ReturnType<typeof newSalon>>, priya: string, n: number) {
  for (let i = 0; i < n; i++)
    await emitAt(salon, ist('12:00') + i * 1000, {
      type: 'schedule_changed',
      userId: priya,
      date: '2026-10-29',
      summary: `Change ${i}`,
    });
}

describe('inbox', () => {
  it('S-15 lists my notifications newest first with the unread count, and nobody else’s', async () => {
    const { salon, priya, owner, staff } = await setup();
    await notify(salon, priya, 3);
    const mine = await callJson<Page>('GET', '/notifications', { cookie: staff });
    expect(mine.status).toBe(200);
    expect(mine.body.items.map((i) => i.title)).toEqual(['Change 2', 'Change 1', 'Change 0']);
    expect(mine.body.unread).toBe(3);
    const theirs = await callJson<Page>('GET', '/notifications', { cookie: owner });
    expect(theirs.body.items).toHaveLength(0);
  });

  it('S-15 pages with a cursor', async () => {
    const { salon, priya, staff } = await setup();
    await notify(salon, priya, 35);
    const first = await callJson<Page>('GET', '/notifications', { cookie: staff });
    expect(first.body.items).toHaveLength(30);
    expect(first.body.nextCursor).not.toBeNull();
    const second = await callJson<Page>(
      'GET',
      `/notifications?cursor=${encodeURIComponent(first.body.nextCursor ?? '')}`,
      { cookie: staff },
    );
    expect(second.body.items).toHaveLength(5);
    expect(second.body.nextCursor).toBeNull();
    const ids = new Set([...first.body.items, ...second.body.items].map((i) => i.id));
    expect(ids.size).toBe(35);
  });

  it('S-15.3 marking read lowers the unread count (by id, then all)', async () => {
    const { salon, priya, staff } = await setup();
    await notify(salon, priya, 4);
    const page = await callJson<Page>('GET', '/notifications', { cookie: staff });
    const ids = page.body.items.slice(0, 2).map((i) => i.id);
    expect(
      (await callJson('POST', '/notifications/read', { cookie: staff, body: { ids } })).status,
    ).toBe(204);
    expect((await callJson<Page>('GET', '/notifications', { cookie: staff })).body.unread).toBe(2);
    await callJson('POST', '/notifications/read', { cookie: staff, body: { all: true } });
    expect((await callJson<Page>('GET', '/notifications', { cookie: staff })).body.unread).toBe(0);
  });

  it('S-15 I cannot mark someone else’s notification read', async () => {
    const { salon, priya, owner, staff } = await setup();
    await notify(salon, priya, 1);
    const page = await callJson<Page>('GET', '/notifications', { cookie: staff });
    await callJson('POST', '/notifications/read', {
      cookie: owner,
      body: { ids: [page.body.items[0]?.id] },
    });
    expect((await callJson<Page>('GET', '/notifications', { cookie: staff })).body.unread).toBe(1);
  });

  it('S-15 opening a push stamps opened_at and marks it read', async () => {
    const { salon, priya, staff } = await setup();
    await notify(salon, priya, 1);
    const page = await callJson<Page>('GET', '/notifications', { cookie: staff });
    const id = page.body.items[0]?.id ?? '';
    expect((await callJson('POST', `/notifications/${id}/opened`, { cookie: staff })).status).toBe(
      204,
    );
    const row = await testEnv.DB.prepare(
      'SELECT opened_at, read_at FROM notifications WHERE id = ?1',
    )
      .bind(id)
      .first<{ opened_at: number | null; read_at: number | null }>();
    expect(row?.opened_at).not.toBeNull();
    expect(row?.read_at).not.toBeNull();
  });

  it('requires a session', async () => {
    await newSalon();
    expect((await callJson('GET', '/notifications')).status).toBe(401);
  });
});

describe('push subscriptions', () => {
  const sub = (n: number) => ({
    endpoint: `https://push.example.test/send/${n}`,
    keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA', auth: 'tBHItJI5svbpez7KI4CCXg' },
    platform: 'android',
  });

  it('S-15 subscribes, replaces the same endpoint, and audits it', async () => {
    const { priya, staff } = await setup();
    expect(
      (await callJson('POST', '/push/subscribe', { cookie: staff, body: sub(1) })).status,
    ).toBe(201);
    await callJson('POST', '/push/subscribe', {
      cookie: staff,
      body: { ...sub(1), platform: 'ios' },
    });
    const rows = await testEnv.DB.prepare(
      'SELECT platform FROM push_subscriptions WHERE user_id = ?1',
    )
      .bind(priya)
      .all<{ platform: string }>();
    expect(rows.results).toEqual([{ platform: 'ios' }]);
    const audit = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'push.subscribe'",
    ).first<{ n: number }>();
    expect(audit?.n).toBe(2);
  });

  it('keeps at most 5 phones per person, dropping the oldest', async () => {
    const { priya, staff } = await setup();
    for (let i = 1; i <= 7; i++) {
      await callJson('POST', '/push/subscribe', { cookie: staff, body: sub(i) });
      await new Promise((r) => setTimeout(r, 2));
    }
    const rows = await testEnv.DB.prepare(
      'SELECT endpoint FROM push_subscriptions WHERE user_id = ?1',
    )
      .bind(priya)
      .all<{ endpoint: string }>();
    expect(rows.results).toHaveLength(5);
    expect(rows.results.map((r) => r.endpoint)).not.toContain('https://push.example.test/send/1');
  });

  it('S-15 unsubscribes only my own endpoint', async () => {
    const { salon, priya, owner, staff } = await setup();
    await callJson('POST', '/push/subscribe', { cookie: staff, body: sub(1) });
    await callJson('DELETE', '/push/subscribe', {
      cookie: owner,
      body: { endpoint: sub(1).endpoint },
    });
    expect((await subscribe(salon, priya, 0)).length).toBe(0);
    const still = await testEnv.DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first<{
      n: number;
    }>();
    expect(still?.n).toBe(1);
    expect(
      (
        await callJson('DELETE', '/push/subscribe', {
          cookie: staff,
          body: { endpoint: sub(1).endpoint },
        })
      ).status,
    ).toBe(204);
    const gone = await testEnv.DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first<{
      n: number;
    }>();
    expect(gone?.n).toBe(0);
  });

  it('rejects a malformed subscription', async () => {
    const { staff } = await setup();
    const bad = await callJson('POST', '/push/subscribe', {
      cookie: staff,
      body: { endpoint: 'nope', keys: { p256dh: '', auth: '' }, platform: 'android' },
    });
    expect(bad.status).toBe(400);
  });
});

describe('preferences', () => {
  interface Prefs {
    events: { type: string; push: boolean; whatsapp: boolean; email: boolean; locked: boolean }[];
  }

  it('S-15 staff see staff events, the owner sees owner events, security events are locked', async () => {
    const { owner, staff } = await setup();
    const s = await callJson<Prefs>('GET', '/me/notification-prefs', { cookie: staff });
    const o = await callJson<Prefs>('GET', '/me/notification-prefs', { cookie: owner });
    const st = s.body.events.map((e) => e.type);
    const ot = o.body.events.map((e) => e.type);
    expect(st).toContain('checkin_reminder');
    expect(st).not.toContain('late_checkin');
    expect(ot).toContain('late_checkin');
    expect(ot).not.toContain('checkin_reminder');
    expect(ot).not.toContain('sign_in_link');
    for (const e of o.body.events)
      expect(e.locked).toBe(e.type === 'new_device' || e.type === 'pin_attempts');
    // PRD defaults: early check-out is in-app only until switched on.
    expect(o.body.events.find((e) => e.type === 'early_checkout')?.push).toBe(false);
    expect(o.body.events.find((e) => e.type === 'late_checkin')?.push).toBe(true);
  });

  it('S-15 saves switches, keeps security events on, and audits the change', async () => {
    const { owner } = await setup();
    const current = await callJson<Prefs>('GET', '/me/notification-prefs', { cookie: owner });
    const events = current.body.events.map((e) =>
      e.type === 'late_checkin' || e.type === 'new_device' ? { ...e, push: false } : e,
    );
    const saved = await callJson<Prefs>('PUT', '/me/notification-prefs', {
      cookie: owner,
      body: { events },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.events.find((e) => e.type === 'late_checkin')?.push).toBe(false);
    expect(saved.body.events.find((e) => e.type === 'new_device')?.push).toBe(true);
    const again = await callJson<Prefs>('GET', '/me/notification-prefs', { cookie: owner });
    expect(again.body.events.find((e) => e.type === 'late_checkin')?.push).toBe(false);
    const audit = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'notification_prefs.update'",
    ).first<{ n: number }>();
    expect(audit?.n).toBe(1);
  });

  it('ignores event types that do not apply to my role', async () => {
    const { staff, priya } = await setup();
    const current = await callJson<Prefs>('GET', '/me/notification-prefs', { cookie: staff });
    await callJson('PUT', '/me/notification-prefs', {
      cookie: staff,
      body: {
        events: [
          ...current.body.events,
          { type: 'late_checkin', push: false, whatsapp: false, email: false, locked: false },
        ],
      },
    });
    const row = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS n FROM notification_prefs WHERE user_id = ?1 AND event_type = 'late_checkin'",
    )
      .bind(priya)
      .first<{ n: number }>();
    expect(row?.n).toBe(0);
  });
});
