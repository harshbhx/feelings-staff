/** Append-only audit log (PRD 10.7). Owner: WP-1. Only insert and select exist. */
import { ulid } from '../lib/ulid';
import type { Audit, AuditEntry, Ctx } from './ports';

function toJson(v: unknown): string | null {
  return v === undefined || v === null ? null : JSON.stringify(v);
}

export function createAudit(): Audit {
  const stmt = (ctx: Ctx, e: AuditEntry): D1PreparedStatement => {
    const actorType =
      e.actorType ?? (ctx.user ? 'user' : ctx.session?.kind === 'door' ? 'door' : 'system');
    const actorId =
      e.actorId !== undefined ? e.actorId : (ctx.user?.id ?? ctx.session?.deviceId ?? null);
    return ctx.db.insert('audit_log', {
      id: ulid(ctx.now()),
      category: e.category,
      actor_type: actorType,
      actor_id: actorId,
      action: e.action,
      entity: e.entity,
      entity_id: e.entityId ?? null,
      before_json: toJson(e.before),
      after_json: toJson(e.after),
      reason: e.reason ?? null,
      ip_hmac: ctx.ipHmac,
      request_id: ctx.requestId,
      created_at: ctx.now(),
    });
  };
  return {
    stmt,
    async log(ctx, e) {
      await stmt(ctx, e).run();
    },
  };
}
