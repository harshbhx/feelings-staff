/**
 * Owner demo-data buttons, database side (preview only; the endpoints answer 404 elsewhere, see
 * lib/preview-gate.ts). Wipes the preview database and seeds the synthetic demo salon, then puts the
 * caller's session back on the new owner so the owner is not signed out between the steps.
 * Lives in seed/ because it uses raw D1, like the rest of the seed code.
 */
import { addDays, istDate } from '@fs/contracts';
import { applyMigrations, wipeAll } from '../db/schema';
import type { Env } from '../env';
import { forgetSingleOrg } from '../middleware/context';
import type { SessionInfo } from '../services/ports';
import { seedScenario } from './index';

/** Days of raw punches the demo seed writes and the client then recomputes (same as seed-demo.mjs). */
export const DEMO_DAYS = 49;

export interface DemoSeeded {
  staff: number;
  from: string;
  to: string;
  sessionKept: boolean;
}

/**
 * Wipe everything and seed the demo salon. The owner is a new row, so the caller's session row is
 * written again (same token, same expiry and step-up window) for the new owner. If the seed fails
 * after the wipe it is tried once more, because the wipe already ended every session.
 */
export async function reseedDemo(
  env: Env,
  db: D1Database,
  session: SessionInfo | null,
  now: number,
): Promise<DemoSeeded> {
  await applyMigrations(db);
  await wipeAll(db);
  forgetSingleOrg();
  let seeded: Awaited<ReturnType<typeof seedScenario>>;
  try {
    seeded = await seedScenario({ env, db, now }, 'demo');
  } catch {
    await wipeAll(db);
    forgetSingleOrg();
    seeded = await seedScenario({ env, db, now }, 'demo');
  }
  let sessionKept = false;
  if (session && session.kind === 'user') {
    const owner = await db
      .prepare("SELECT id FROM users WHERE org_id = ?1 AND role = 'owner' LIMIT 1")
      .bind(seeded.orgId)
      .first<{ id: string }>();
    if (owner) {
      await db
        .prepare(
          `INSERT INTO sessions (token_hash, org_id, kind, user_id, device_id, created_at, last_seen_at, expires_at, step_up_until)
           VALUES (?1, ?2, 'user', ?3, NULL, ?4, ?5, ?6, ?7)`,
        )
        .bind(
          session.tokenHash,
          seeded.orgId,
          owner.id,
          session.createdAt,
          now,
          session.expiresAt,
          session.stepUpUntil,
        )
        .run();
      sessionKept = true;
    }
  }
  const to = istDate(now);
  return { staff: seeded.staff.length, from: addDays(to, -(DEMO_DAYS - 1)), to, sessionKept };
}
