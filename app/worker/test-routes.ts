/**
 * Test-only endpoints (PRD 9.4): reset + seed, fake clock, run a cron job, read the outbox.
 * Refused in production and without a matching X-E2E-Token (lib/api.ts answers 404). Owner: WP-1.
 */
import { runJob } from './cron';
import { json } from './db';
import { applyMigrations, wipeAll } from './db/schema';
import type { Handlers } from './lib/api';
import { forgetSingleOrg } from './middleware/context';
import { seedScenario } from './seed';
import { TEST_CLOCK_KEY } from './services/clock';

export const handlers: Handlers = {
  async testReset({ body }, ctx) {
    const db = ctx.env.DB;
    await applyMigrations(db);
    await wipeAll(db);
    forgetSingleOrg();
    return seedScenario({ env: ctx.env, db, now: Date.now() }, body.scenario);
  },

  async testClock({ body }, ctx) {
    if (body.nowMs === null) {
      await ctx.sys.run('DELETE FROM app_meta WHERE key = ?1', TEST_CLOCK_KEY);
      return { nowMs: Date.now(), fake: false };
    }
    await ctx.sys.run(
      'INSERT OR REPLACE INTO app_meta (key, value) VALUES (?1, ?2)',
      TEST_CLOCK_KEY,
      JSON.stringify({ nowMs: body.nowMs, setAt: Date.now() }),
    );
    return { nowMs: body.nowMs, fake: true };
  },

  async testCron({ body }, ctx) {
    const at = body.at ?? ctx.now();
    const summary = await runJob(body.job, ctx.env, at);
    return { job: body.job, at, summary };
  },

  async testOutbox(_input, ctx) {
    if (!ctx.orgId) return { items: [] };
    const rows = await ctx.db.all<{
      channel: 'push' | 'email' | 'whatsapp';
      to_addr: string;
      payload_json: string;
      created_at: number;
    }>(
      'SELECT channel, to_addr, payload_json, created_at FROM test_outbox WHERE org_id = ?org ORDER BY created_at, id',
    );
    return {
      items: rows.map((r) => ({
        channel: r.channel,
        to: r.to_addr,
        at: r.created_at,
        payload: json<unknown>(r.payload_json, null),
      })),
    };
  },
};
