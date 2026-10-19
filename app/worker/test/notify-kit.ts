/**
 * Test kit for WP-8 (notifications and cron): staff, subscriptions, punches, duties and a system
 * Ctx at a chosen time. Raw D1 access is allowed here because this folder is test-only.
 */
import { istToEpoch, type NotifyEvent } from '@fs/contracts';
import { systemCtx } from '../cron/context';
import { ulid } from '../lib/ulid';
import type { Ctx } from '../services/ports';
import { resetScenario, type Scenario, testEnv } from './helpers';

/** The basic-salon scenario shifts everyone onto Monday 19 Oct 2026 unless a test says otherwise. */
export const DAY = '2026-10-19';
export const ist = (hhmm: string, date: string = DAY) => istToEpoch(date, hhmm);

export interface Salon {
  scenario: Scenario;
  orgId: string;
  ownerId: string;
}

export async function newSalon(): Promise<Salon> {
  const scenario = await resetScenario('basic-salon');
  return { scenario, orgId: scenario.orgId, ownerId: scenario.ownerId };
}

export async function templateId(name = 'Full day'): Promise<string> {
  const row = await testEnv.DB.prepare('SELECT id FROM shift_templates WHERE name = ?1')
    .bind(name)
    .first<{ id: string }>();
  if (!row) throw new Error(`no template ${name}`);
  return row.id;
}

export async function addUser(
  salon: Salon,
  opts: {
    name: string;
    role?: 'staff' | 'manager';
    lang?: 'en' | 'gu';
    permissions?: string[];
    template?: string;
    weekOffDow?: number | null;
    joinDate?: string;
    exitDate?: string | null;
    status?: 'active' | 'exited' | 'suspended';
  },
): Promise<string> {
  const id = ulid();
  const now = Date.now();
  const tpl = await templateId(opts.template ?? 'Full day');
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO users (id, org_id, role, name, phone_e164, lang, status, permissions_json, created_at, updated_at, exited_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, ?10)`,
    ).bind(
      id,
      salon.orgId,
      opts.role ?? 'staff',
      opts.name,
      `+9199${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
      opts.lang ?? 'en',
      opts.status ?? 'active',
      opts.permissions ? JSON.stringify(opts.permissions) : null,
      now,
      opts.exitDate ? istToEpoch(opts.exitDate, '10:00') : null,
    ),
    testEnv.DB.prepare(
      `INSERT INTO staff_profiles (user_id, org_id, designation, join_date, exit_date, default_template_id, week_off_dow, created_at, updated_at)
       VALUES (?1, ?2, 'Stylist', ?3, ?4, ?5, ?6, ?7, ?7)`,
    ).bind(
      id,
      salon.orgId,
      opts.joinDate ?? '2026-01-01',
      opts.exitDate ?? null,
      tpl,
      opts.weekOffDow ?? 0,
      now,
    ),
  ]);
  return id;
}

export async function subscribe(salon: Salon, userId: string, n = 1): Promise<string[]> {
  const endpoints: string[] = [];
  for (let i = 0; i < n; i++) {
    const endpoint = `https://push.example.test/${userId}/${i}`;
    endpoints.push(endpoint);
    await testEnv.DB.prepare(
      `INSERT INTO push_subscriptions (id, org_id, user_id, endpoint, p256dh, auth, platform, created_at)
       VALUES (?1, ?2, ?3, ?4, 'p256dh-key', 'auth-key', 'android', ?5)`,
    )
      .bind(ulid(), salon.orgId, userId, endpoint, Date.now())
      .run();
  }
  return endpoints;
}

export async function addPunch(
  salon: Salon,
  userId: string,
  kind: 'in' | 'out',
  ts: number,
  opts: { date?: string; status?: string; source?: string } = {},
): Promise<string> {
  const id = ulid(ts);
  await testEnv.DB.prepare(
    `INSERT INTO punches (id, org_id, user_id, kind, server_ts, effective_ts, work_date, source, status, idempotency_key, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, ?7, ?8, ?9, ?5)`,
  )
    .bind(
      id,
      salon.orgId,
      userId,
      kind,
      ts,
      opts.date ?? DAY,
      opts.source ?? 'online',
      opts.status ?? 'accepted',
      `k-${id}`,
    )
    .run();
  return id;
}

export async function ctxAt(salon: Salon, at: number): Promise<Ctx> {
  return (await systemCtx(testEnv, salon.orgId, at)).ctx;
}

/** Emit one event through the real Notifier at time `at`. */
export async function emitAt(
  salon: Salon,
  at: number,
  e: DistributiveOmit<NotifyEvent, 'orgId' | 'at'>,
) {
  const { ctx } = await systemCtx(testEnv, salon.orgId, at);
  await ctx.services.notifier.emit(ctx, { ...e, orgId: salon.orgId, at } as NotifyEvent);
  return ctx;
}

type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;

export interface InboxRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  url: string;
  priority: string;
  topic: string | null;
  push_status: string;
  batch_key: string | null;
  read_at: number | null;
}

export async function inbox(userId: string): Promise<InboxRow[]> {
  const res = await testEnv.DB.prepare(
    `SELECT id, user_id, type, title, body, url, priority, topic, push_status, batch_key, read_at
       FROM notifications WHERE user_id = ?1 ORDER BY created_at, id`,
  )
    .bind(userId)
    .all<InboxRow>();
  return res.results;
}

export async function allInbox(): Promise<InboxRow[]> {
  const res = await testEnv.DB.prepare(
    `SELECT id, user_id, type, title, body, url, priority, topic, push_status, batch_key, read_at
       FROM notifications ORDER BY created_at, id`,
  ).all<InboxRow>();
  return res.results;
}

export async function setSettings(
  salon: Salon,
  patch: (settings: Record<string, Record<string, unknown>>) => void,
): Promise<void> {
  const row = await testEnv.DB.prepare('SELECT settings_json FROM orgs WHERE id = ?1')
    .bind(salon.orgId)
    .first<{ settings_json: string }>();
  const s = JSON.parse(row?.settings_json ?? '{}') as Record<string, Record<string, unknown>>;
  patch(s);
  await testEnv.DB.prepare('UPDATE orgs SET settings_json = ?1 WHERE id = ?2')
    .bind(JSON.stringify(s), salon.orgId)
    .run();
}
