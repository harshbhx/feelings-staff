/** Door device endpoints (PRD 4.5): pair with a one-time code, status line for the kiosk. */
import { nameWithInitial } from '@fs/contracts';
import type { Handlers } from '../../lib/api';
import { fail } from '../../lib/errors';
import { pairDoor, salonNetworkStmt } from '../../services/door';

export const handlers: Handlers = {
  async doorPair({ body }, ctx, c) {
    return pairDoor(ctx, c, body.pairingCode);
  },

  async doorStatus(_input, ctx) {
    const deviceId = ctx.session?.deviceId ?? fail('UNAUTHENTICATED');
    const now = ctx.now();
    const device = await ctx.db.first<{ site_id: string; status: string }>(
      'SELECT site_id, status FROM door_devices WHERE org_id = ?org AND id = ?',
      deviceId,
    );
    if (device?.status !== 'active') fail('UNAUTHENTICATED');
    const last = await ctx.db.first<{ name: string; effective_ts: number }>(
      `SELECT u.name, p.effective_ts FROM punches p JOIN users u ON u.id = p.user_id
        WHERE p.org_id = ?org AND p.kind = 'in' AND p.status IN ('accepted', 'flagged')
          AND p.site_id = ? AND p.effective_ts >= ?
        ORDER BY p.effective_ts DESC LIMIT 1`,
      device.site_id,
      now - 16 * 3_600_000,
    );
    const net = salonNetworkStmt(ctx);
    await ctx.db.batch([
      ctx.db.update('door_devices', { last_seen_at: now }, 'id = ?', deviceId),
      ...(net ? [net] : []),
    ]);
    return {
      lastCheckIn: last
        ? {
            firstName: nameWithInitial(last.name).split(' ')[0] ?? last.name,
            at: last.effective_ts,
          }
        : null,
      serverTime: now,
    };
  },
};
