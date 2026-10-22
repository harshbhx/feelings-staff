/**
 * Session helpers for WP-3 on top of middleware/session.ts (PRD 9.1, 10.3): sign-in replaces the
 * caller's old session, and device or account changes revoke the sessions they invalidate.
 * Owner: WP-3.
 */
import type { Role } from '@fs/contracts';
import type { Context } from 'hono';
import type { AppEnv } from '../lib/app-env';
import { issueSession, revokeSession } from '../middleware/session';
import type { Ctx } from './ports';

/** Start a user session (cookie + row), revoking the session the request came with, if any. */
export async function startUserSession(
  ctx: Ctx,
  c: Context<AppEnv>,
  user: { id: string; orgId: string; role: Role },
  deviceId: string | null,
  /** Owner passkey the session is bound to (owner host, docs/owner-access.md). */
  passkeyId?: string,
): Promise<{ tokenHash: string; createdAt: number }> {
  if (ctx.session) await revokeSession(ctx, null, ctx.session.tokenHash);
  const tokenHash = await issueSession(ctx, c, {
    orgId: user.orgId,
    kind: 'user',
    userId: user.id,
    deviceId,
    role: user.role,
    ...(passkeyId ? { passkeyId } : {}),
  });
  return { tokenHash, createdAt: ctx.now() };
}

/** Statement that revokes every live session bound to one device (reject, revoke, replaced). */
export function revokeDeviceSessionsStmt(ctx: Ctx, deviceId: string): D1PreparedStatement {
  return ctx.db.stmt(
    'UPDATE sessions SET revoked_at = ? WHERE org_id = ?org AND device_id = ? AND revoked_at IS NULL',
    ctx.now(),
    deviceId,
  );
}

/** Statement that revokes every live session of a user, optionally keeping one. */
export function revokeUserSessionsStmt(
  ctx: Ctx,
  userId: string,
  exceptTokenHash?: string,
): D1PreparedStatement {
  return ctx.db.stmt(
    `UPDATE sessions SET revoked_at = ? WHERE org_id = ?org AND user_id = ? AND revoked_at IS NULL
       AND token_hash <> ?`,
    ctx.now(),
    userId,
    exceptTokenHash ?? '',
  );
}
