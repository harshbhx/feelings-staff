/** Preview/local outbox (WP-1). WP-8's senders call this instead of sending when not in production. */
import { isNonProd } from '../env';
import { ulid } from '../lib/ulid';
import type { Outbox } from './ports';

export function createOutbox(): Outbox {
  return {
    async record(ctx, channel, to, payload) {
      if (!isNonProd(ctx.env) || !ctx.orgId) return;
      await ctx.db
        .insert('test_outbox', {
          id: ulid(ctx.now()),
          channel,
          to_addr: to,
          payload_json: JSON.stringify(payload ?? null),
          created_at: ctx.now(),
        })
        .run();
    },
  };
}
