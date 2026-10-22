/**
 * Device requests on the owner host (ADR-19, docs/owner-access.md "Passkeys" flow 3, slice 5): a new
 * device asks with "Add this device" and shows a 6-digit code; an approved device sees the request in
 * Needs action and approves it with its fingerprint plus the owner PIN (step-up), or declines it. The
 * new device keeps the enrolment token it was given (never shown), polls its request with it and,
 * once approved, has 10 minutes to create its passkey with it (the enrol routes in owner-access.ts).
 * Requests expire after 15 minutes. Every handler answers NOT_FOUND off the owner host.
 * Owner: WP-3.
 */
import type { Handlers } from '../../lib/api';
import { randomDigits, randomToken } from '../../lib/crypto';
import { fail } from '../../lib/errors';
import { ulid } from '../../lib/ulid';
import { requireOrg } from '../../services/auth';
import {
  assertRequestBudget,
  confirmOnThisDevice,
  type DeviceRequestRow,
  enrolTokenHash,
  REQUEST_COLUMNS,
  REQUEST_TTL_MS,
  requestByToken,
  requestState,
  requestView,
  statusAt,
} from '../../services/owner-devices';
import { ownerRelyingParty } from '../../services/passkey';
import type { Ctx } from '../../services/ports';

const USED = 'This phone is already added. Sign in with your fingerprint.';
const RAN_OUT = 'This request ran out of time. Ask again on the new device.';
const DECIDED = 'This device was already approved or declined.';

/** The owner of a passkey session (list and decide happen on an approved device only). */
function approvingOwner(ctx: Ctx): { id: string } {
  const session = ctx.session;
  const user = ctx.user;
  if (!session || !user) fail('UNAUTHENTICATED');
  if (user.role !== 'owner') fail('FORBIDDEN');
  if (!session.passkeyId)
    fail('FORBIDDEN', 'Sign in with your fingerprint first.', { reason: 'passkey_session' });
  return { id: user.id };
}

export const deviceRequestHandlers: Handlers = {
  // ---- The new device ---------------------------------------------------------------------------

  async ownerDeviceRequestCreate({ body }, ctx, c) {
    ownerRelyingParty(c);
    requireOrg(ctx);
    // Somebody has to be able to approve it: an active owner with a passkey.
    const approvers = await ctx.db.first<{ n: number }>(
      `SELECT COUNT(*) AS n FROM owner_passkeys p JOIN users u ON u.id = p.user_id
        WHERE p.org_id = ?org AND p.removed_at IS NULL AND u.role = 'owner' AND u.status = 'active'`,
    );
    if ((approvers?.n ?? 0) === 0)
      fail('RULE_VIOLATION', 'No phone has a passkey yet. Use the email code on the first one.', {
        reason: 'no_device',
      });
    await assertRequestBudget(ctx);
    const now = ctx.now();
    const id = ulid(now);
    const enrolToken = randomToken(32);
    const code = randomDigits(6);
    const expiresAt = now + REQUEST_TTL_MS;
    // City only, for the approval card ("from Rajkot"); never anything more precise.
    const city = typeof ctx.cf?.city === 'string' && ctx.cf.city ? ctx.cf.city.slice(0, 80) : null;
    await ctx.db.batch([
      ctx.db.insert('owner_device_requests', {
        id,
        code,
        device_name: body.deviceName,
        platform: body.platform,
        city,
        status: 'pending',
        enrol_token_hash: await enrolTokenHash(ctx, enrolToken),
        ip_hmac: ctx.ipHmac,
        expires_at: expiresAt,
        created_at: now,
      }),
      ctx.services.audit.stmt(ctx, {
        category: 'security',
        action: 'owner.device_requested',
        entity: 'owner_device_request',
        entityId: id,
        after: { deviceName: body.deviceName, platform: body.platform, city },
      }),
    ]);
    return { id, code, expiresAt, enrolToken };
  },

  async ownerDeviceRequestStatus({ params, body }, ctx, c) {
    ownerRelyingParty(c);
    requireOrg(ctx);
    const row = await requestByToken(ctx, body.enrolToken);
    // A token of another request, or no request at all, looks the same.
    if (row?.id !== params.id) fail('NOT_FOUND');
    if (row.used_at !== null) fail('LINK_EXPIRED', USED);
    return requestState(row, ctx.now());
  },

  // ---- The approved device --------------------------------------------------------------------------

  async ownerDeviceRequestList(_input, ctx, c) {
    ownerRelyingParty(c);
    approvingOwner(ctx);
    const now = ctx.now();
    const rows = await ctx.db.all<DeviceRequestRow>(
      `SELECT ${REQUEST_COLUMNS} FROM owner_device_requests
        WHERE org_id = ?org AND status = 'pending' AND expires_at > ? ORDER BY created_at DESC, id DESC`,
      now,
    );
    return { requests: rows.map((r) => requestView(r, now)) };
  },

  async ownerDeviceRequestDecide({ params, body }, ctx, c) {
    const rp = ownerRelyingParty(c);
    const owner = approvingOwner(ctx);
    const now = ctx.now();
    const row = await ctx.db.first<DeviceRequestRow>(
      `SELECT ${REQUEST_COLUMNS} FROM owner_device_requests WHERE org_id = ?org AND id = ?`,
      params.id,
    );
    if (!row) fail('NOT_FOUND');
    const status = statusAt(row, now);
    if (status === 'expired') {
      if (row.status === 'pending')
        await ctx.db.run(
          `UPDATE owner_device_requests SET status = 'expired'
            WHERE org_id = ?org AND id = ? AND status = 'pending'`,
          row.id,
        );
      fail('LINK_EXPIRED', RAN_OUT);
    }
    if (status !== 'pending') fail('ALREADY_DECIDED', DECIDED);
    const facts = { deviceName: row.device_name, platform: row.platform, city: row.city };

    if (body.decision === 'decline') {
      // The claim is one conditional UPDATE, so two decisions at once cannot both pass.
      const claimed = await ctx.db.run(
        `UPDATE owner_device_requests SET status = 'declined', user_id = ?, decided_at = ?
          WHERE org_id = ?org AND id = ? AND status = 'pending' AND expires_at > ?`,
        owner.id,
        now,
        row.id,
        now,
      );
      if (claimed.meta.changes !== 1) fail('ALREADY_DECIDED', DECIDED);
      await ctx.services.audit.log(ctx, {
        category: 'security',
        action: 'owner.device_declined',
        entity: 'owner_device_request',
        entityId: row.id,
        after: facts,
      });
      return requestView({ ...row, status: 'declined', user_id: owner.id, decided_at: now }, now);
    }

    // Approve: the fingerprint on this device first (the PIN was checked before the handler ran).
    const { own, touch } = await confirmOnThisDevice(ctx, rp, body.challengeId, body.credential);
    const claimed = await ctx.db.run(
      `UPDATE owner_device_requests SET status = 'approved', user_id = ?, approved_by_credential = ?,
              decided_at = ?
        WHERE org_id = ?org AND id = ? AND status = 'pending' AND expires_at > ?`,
      owner.id,
      own.id,
      now,
      row.id,
      now,
    );
    if (claimed.meta.changes !== 1) fail('ALREADY_DECIDED', DECIDED);
    await ctx.db.batch([
      touch,
      ctx.services.audit.stmt(ctx, {
        category: 'security',
        action: 'owner.device_approved',
        entity: 'owner_device_request',
        entityId: row.id,
        after: { ...facts, approvedOn: own.device_name },
      }),
    ]);
    return requestView(
      {
        ...row,
        status: 'approved',
        user_id: owner.id,
        approved_by_credential: own.id,
        decided_at: now,
      },
      now,
    );
  },
};
