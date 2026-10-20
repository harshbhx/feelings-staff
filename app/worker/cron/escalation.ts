/**
 * WhatsApp escalation (PRD 6, P1, owner opt-in): a critical owner push (not-in-yet N3, punch needs
 * approval N6, new device N19) that is still unopened 15 minutes after it was pushed, and this is
 * outside quiet hours, goes to the owner as one WhatsApp utility template. At most 10 a day.
 * The send goes through `sendWhatsApp`, which records to the outbox in preview and never calls Meta
 * without the configured secrets. Each notification is claimed in `cron_runs` once. Owner: WP-8.
 */
import { HOUR_MS, MINUTE_MS } from '@fs/contracts';
import { loadOrg } from '../lib/settings';
import { inQuietHours } from '../services/notifier';
import type { Ctx } from '../services/ports';
import { sendWhatsApp } from '../services/whatsapp';
import { once } from './context';

export const ESCALATION_TYPES = ['not_in_yet', 'punch_needs_approval', 'new_device'] as const;
export const ESCALATION_AFTER_MS = 15 * MINUTE_MS;
/** An alert older than this is stale: the owner has most likely seen it another way. */
export const ESCALATION_MAX_AGE_MS = 2 * HOUR_MS;
export const WHATSAPP_DAILY_CAP = 10;
export const WHATSAPP_TEMPLATE = 'owner_alert';

interface Candidate {
  id: string;
  type: string;
  title: string;
  body: string | null;
  data_json: string | null;
}

export async function whatsappEscalation(ctx: Ctx, job: string, date: string): Promise<number> {
  const at = ctx.now();
  const { settings } = await loadOrg(ctx);
  const q = settings.notifications;
  if (!q.whatsappFallback) return 0;
  if (q.quietHours.enabled && inQuietHours(at, q.quietHours.start, q.quietHours.end)) return 0;

  const owner = await ctx.db.first<{ id: string; phone_e164: string | null; lang: string }>(
    "SELECT id, phone_e164, lang FROM users WHERE org_id = ?org AND role = 'owner' AND status = 'active' LIMIT 1",
  );
  if (!owner?.phone_e164) return 0;

  const marks = ESCALATION_TYPES.map(() => '?').join(', ');
  const rows = await ctx.db.all<Candidate>(
    `SELECT n.id, n.type, n.title, n.body, n.data_json FROM notifications n
      WHERE n.org_id = ?org AND n.user_id = ? AND n.type IN (${marks})
        AND n.push_status = 'sent' AND n.opened_at IS NULL AND n.read_at IS NULL AND n.wa_status IS NULL
        AND n.push_sent_at <= ? AND n.push_sent_at > ?
        AND NOT EXISTS (SELECT 1 FROM notification_prefs p
                         WHERE p.user_id = n.user_id AND p.event_type = n.type AND p.whatsapp = 0)
      ORDER BY n.push_sent_at, n.id`,
    owner.id,
    ...ESCALATION_TYPES,
    at - ESCALATION_AFTER_MS,
    at - ESCALATION_MAX_AGE_MS,
  );

  let sent = 0;
  for (const n of rows) {
    if (await resolvedElsewhere(ctx, n)) continue;
    const ran = await once(ctx, job, `${date}|wa_escalation|${n.id}`, async () => {
      const used = await ctx.db.first<{ n: number }>(
        `SELECT COUNT(*) AS n FROM cron_runs WHERE job = ? AND org_id = ?org AND slot LIKE ?
            AND result IN ('sent', 'recorded')`,
        job,
        `${date}|wa_escalation|%`,
      );
      if ((used?.n ?? 0) >= WHATSAPP_DAILY_CAP) return 'capped';
      const result = await sendWhatsApp(ctx, owner.phone_e164 as string, {
        template: WHATSAPP_TEMPLATE,
        lang: owner.lang === 'gu' ? 'gu' : 'en',
        params: [n.title, (n.body ?? '').replace(/\s*\n\s*/g, ' ')],
      });
      await ctx.db.batch([
        ctx.db.stmt(
          'UPDATE notifications SET wa_status = ? WHERE org_id = ?org AND id = ?',
          result,
          n.id,
        ),
        ctx.services.audit.stmt(ctx, {
          category: 'change',
          action: 'notify.whatsapp_escalation',
          entity: 'notification',
          entityId: n.id,
          after: { type: n.type, result },
          actorType: 'system',
        }),
      ]);
      return result;
    });
    if (ran) sent += 1;
  }
  return sent;
}

/** A not-in-yet alert is moot once the person has punched in. */
async function resolvedElsewhere(ctx: Ctx, n: Candidate): Promise<boolean> {
  if (n.type !== 'not_in_yet' || !n.data_json) return false;
  try {
    const d = JSON.parse(n.data_json) as { userId?: string; workDate?: string };
    if (!d.userId || !d.workDate) return false;
    const p = await ctx.db.first<{ id: string }>(
      `SELECT id FROM punches WHERE org_id = ?org AND user_id = ? AND work_date = ? AND kind = 'in'
          AND status NOT IN ('rejected', 'superseded') LIMIT 1`,
      d.userId,
      d.workDate,
    );
    return Boolean(p);
  } catch {
    return false;
  }
}
