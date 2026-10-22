/**
 * Retention purge (PRD 8.3, 10.9). Every row of the table, in batches of 500 rows per D1 statement,
 * idempotent (a second run finds nothing), with the counts written to `audit_log` as
 * `retention.purge`. Owner: WP-8.
 */

import type { OrgSettings } from '@fs/contracts';
import { DAY_MS, istDate } from '@fs/contracts';
import type { Ctx } from '../services/ports';

export const BATCH_ROWS = 500;
const MAX_BATCHES = 200;
const HOLD_PREFIX = 'hold/';

type Counts = Record<string, number>;

async function loop(run: () => Promise<number>): Promise<number> {
  let total = 0;
  for (let i = 0; i < MAX_BATCHES; i++) {
    const n = await run();
    total += n;
    if (n < BATCH_ROWS) break;
  }
  return total;
}

/** DELETE ... in chunks of 500 rows. `where` may use `?` placeholders bound to `params`. */
async function del(
  ctx: Ctx,
  table: string,
  where: string,
  ...params: (string | number)[]
): Promise<number> {
  return loop(async () => {
    const res = await ctx.db.run(
      `DELETE FROM ${table} WHERE org_id = ?org AND rowid IN
         (SELECT rowid FROM ${table} WHERE org_id = ?org AND (${where}) LIMIT ${BATCH_ROWS})`,
      ...params,
    );
    return res.meta.changes ?? 0;
  });
}

async function upd(
  ctx: Ctx,
  table: string,
  set: string,
  where: string,
  ...params: (string | number)[]
): Promise<number> {
  return loop(async () => {
    const res = await ctx.db.run(
      `UPDATE ${table} SET ${set} WHERE org_id = ?org AND rowid IN
         (SELECT rowid FROM ${table} WHERE org_id = ?org AND (${where}) LIMIT ${BATCH_ROWS})`,
      ...params,
    );
    return res.meta.changes ?? 0;
  });
}

/** Same calendar day, `years` earlier (29 Feb falls back to 28 Feb). */
export function yearsBefore(date: string, years: number): string {
  const y = Number(date.slice(0, 4)) - years;
  const md = date.slice(5);
  return md === '02-29' ? `${y}-02-28` : `${y}-${md}`;
}

/** Nightly rows of PRD 8.3. */
export async function purgeNightly(ctx: Ctx, at: number, settings: OrgSettings): Promise<Counts> {
  const c: Counts = {};
  const day = (n: number) => at - n * DAY_MS;
  const locationCut = day(settings.privacy.locationRetentionDays);
  const selfieCut = day(settings.privacy.selfieRetentionDays);

  // Location detail on punches goes after 90 days; the fence result and risk fields stay.
  c.punch_location = await upd(
    ctx,
    'punches',
    'lat = NULL, lng = NULL, accuracy_m = NULL, distance_m = NULL',
    `created_at < ? AND (lat IS NOT NULL OR lng IS NOT NULL OR accuracy_m IS NOT NULL OR distance_m IS NOT NULL)`,
    locationCut,
  );

  // Selfies: remove the file now (the R2 lifecycle rule is the backstop) and stamp the row.
  c.selfies = 0;
  for (let i = 0; i < MAX_BATCHES; i++) {
    const rows = await ctx.db.all<{ id: string; selfie_key: string }>(
      `SELECT id, selfie_key FROM punches
        WHERE org_id = ?org AND selfie_key IS NOT NULL AND selfie_deleted_at IS NULL
          AND selfie_key NOT LIKE '${HOLD_PREFIX}%' AND created_at < ? LIMIT ${BATCH_ROWS}`,
      selfieCut,
    );
    if (rows.length === 0) break;
    await ctx.env.MEDIA.delete(rows.map((r) => r.selfie_key));
    await ctx.db.batch(
      rows.map((r) =>
        ctx.db.stmt(
          'UPDATE punches SET selfie_deleted_at = ? WHERE org_id = ?org AND id = ?',
          at,
          r.id,
        ),
      ),
    );
    c.selfies += rows.length;
    if (rows.length < BATCH_ROWS) break;
  }

  // Audit: security and access rows for 1 year.
  c.audit_security = await del(
    ctx,
    'audit_log',
    "category IN ('security', 'access') AND created_at < ?",
    day(365),
  );
  c.sessions = await del(ctx, 'sessions', 'expires_at < ?', day(7));
  c.challenges = await del(ctx, 'challenges', 'expires_at < ?', day(7));
  // Owner access (docs/owner-access.md): passkey challenges like the other challenges; device requests
  // and recovery codes 30 days after they ran out; a removed passkey after a year, with the security
  // audit rows that name it.
  c.owner_passkey_challenges = await del(ctx, 'owner_passkey_challenges', 'expires_at < ?', day(7));
  c.owner_device_requests = await del(ctx, 'owner_device_requests', 'expires_at < ?', day(30));
  c.owner_recovery_codes = await del(ctx, 'owner_recovery_codes', 'expires_at < ?', day(30));
  c.owner_passkeys = await del(
    ctx,
    'owner_passkeys',
    'removed_at IS NOT NULL AND removed_at < ?',
    day(365),
  );
  c.magic_links = await loop(async () => {
    const res = await ctx.sys.run(
      `DELETE FROM magic_links WHERE rowid IN
         (SELECT rowid FROM magic_links WHERE expires_at < ? LIMIT ${BATCH_ROWS})`,
      day(7),
    );
    return res.meta.changes ?? 0;
  });
  c.idempotency_keys = await del(ctx, 'idempotency_keys', 'created_at < ?', day(7));
  c.test_outbox = await del(ctx, 'test_outbox', 'created_at < ?', day(1));
  c.notifications = await del(ctx, 'notifications', 'created_at < ?', day(180));
  c.devices = await del(
    ctx,
    'devices',
    "status = 'revoked' AND COALESCE(decided_at, approved_at, requested_at) < ?",
    day(30),
  );
  c.calibration_samples = await del(ctx, 'calibration_samples', 'taken_at < ?', day(30));
  c.salon_networks = await del(ctx, 'salon_networks', 'last_seen < ?', day(7));

  // Push subscriptions of people who have left or been suspended.
  c.push_subscriptions = await del(
    ctx,
    'push_subscriptions',
    "user_id IN (SELECT id FROM users WHERE org_id = ?org AND status IN ('exited', 'suspended'))",
  );

  // Exports expire after 7 days: the file (R2 lifecycle is the backstop) and the row.
  const exportsDue = await ctx.db.all<{ r2_key: string | null }>(
    'SELECT r2_key FROM exports WHERE org_id = ?org AND expires_at < ? LIMIT 500',
    at,
  );
  const keys = exportsDue.flatMap((e) => (e.r2_key ? [e.r2_key] : []));
  if (keys.length > 0) await ctx.env.MEDIA.delete(keys);
  c.exports = await del(ctx, 'exports', 'expires_at < ?', at);

  // Staff profile after exit: phone, photo and consent detail go 30 days after the exit.
  const left = `user_id IN (SELECT id FROM users WHERE org_id = ?org AND status = 'exited' AND exited_at < ${day(30)})`;
  c.exit_consents = await del(ctx, 'consents', left);
  c.exit_photos = await upd(
    ctx,
    'staff_profiles',
    'enrolled_photo_key = NULL',
    `enrolled_photo_key IS NOT NULL AND ${left}`,
  );
  c.exit_phones = await upd(
    ctx,
    'users',
    'phone_e164 = NULL',
    `status = 'exited' AND exited_at < ${day(30)} AND phone_e164 IS NOT NULL`,
  );
  return c;
}

/** Monthly rows of PRD 8.3: wage records five years after the person's last entry. */
export async function purgeMonthly(ctx: Ctx, at: number): Promise<Counts> {
  const c: Counts = {};
  const cutoff = yearsBefore(istDate(at), 5);
  const cutoffMonth = cutoff.slice(0, 7);
  const gone = `user_id IN (SELECT user_id FROM staff_profiles WHERE org_id = ?org AND exit_date IS NOT NULL AND exit_date < '${cutoff}')`;
  for (const table of [
    'punches',
    'attendance_days',
    'regularisations',
    'leave_requests',
    'leave_ledger',
    'advance_recoveries',
    'advances',
    'fines',
    'adjustments',
    'payslips',
    'salary_history',
    'ot_decisions',
    'ot_preapprovals',
    'roster_overrides',
  ])
    c[table] = await del(ctx, table, gone);
  c.payroll_runs = await del(
    ctx,
    'payroll_runs',
    `month < '${cutoffMonth}'
       AND NOT EXISTS (SELECT 1 FROM payslips p WHERE p.payroll_run_id = payroll_runs.id)
       AND NOT EXISTS (SELECT 1 FROM adjustments a WHERE a.payroll_run_id = payroll_runs.id)`,
  );
  c.audit_change = await del(
    ctx,
    'audit_log',
    "category IN ('change', 'export') AND created_at < ?",
    at - 5 * 365 * DAY_MS,
  );
  return c;
}

export async function writePurgeAudit(ctx: Ctx, counts: Counts): Promise<void> {
  await ctx.services.audit.log(ctx, {
    category: 'change',
    action: 'retention.purge',
    entity: 'retention',
    after: counts,
    actorType: 'system',
    actorId: null,
  });
}
