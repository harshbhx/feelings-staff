/**
 * Owner access on the owner host (ADR-19, docs/owner-access.md): passkey sign-in, enrolment (the first
 * device after the email code, slice 4; another device with the enrolment token of an approved device
 * request, slice 5), and the device list. Device requests are in owner-device-requests.ts. Every
 * handler answers NOT_FOUND off the owner host (the host routing already does so; this is the second
 * line). Remove (slice 6) and recovery (slice 7) are not built yet and answer 501.
 * Owner: WP-3.
 */
import type { Handlers } from '../../lib/api';
import { fail } from '../../lib/errors';
import { ulid } from '../../lib/ulid';
import { buildMe, requireOrg } from '../../services/auth';
import {
  type DeviceRequestRow,
  ENROL_WINDOW_MS,
  enrolOpen,
  requestByToken,
} from '../../services/owner-devices';
import {
  assertChallengeBudget,
  assertionOptions,
  claimChallenge,
  deviceView,
  livePasskeys,
  ownerRelyingParty,
  PASSKEY_COLUMNS,
  type PasskeyRow,
  registrationOptions,
  rejectPasskey,
  storeChallenge,
  verifyAssertion,
  verifyRegistration,
} from '../../services/passkey';
import { openPinResetWindow } from '../../services/pin-reset';
import type { Ctx } from '../../services/ports';
import { startUserSession } from '../../services/session';
import { deviceRequestHandlers } from './owner-device-requests';

const TOKEN_GONE = 'This request has run out. Ask again on this phone.';

interface OwnerRow {
  id: string;
  name: string;
  email: string | null;
  passkey_enrolled_at: number | null;
}

/** The signed-in owner of a first-device enrolment: an owner session, no passkey yet. */
async function firstDeviceOwner(ctx: Ctx): Promise<{ owner: OwnerRow; sessionHash: string }> {
  const session = ctx.session;
  const user = ctx.user;
  if (!session || !user) fail('UNAUTHENTICATED');
  if (user.role !== 'owner') fail('FORBIDDEN');
  const owner = await ctx.db.first<OwnerRow>(
    `SELECT id, name, email, passkey_enrolled_at FROM users
      WHERE org_id = ?org AND id = ? AND role = 'owner' AND status = 'active'`,
    user.id,
  );
  if (!owner) fail('UNAUTHENTICATED');
  if (owner.passkey_enrolled_at !== null)
    fail(
      'RULE_VIOLATION',
      'This account already has a passkey. Add this phone from a phone that has one.',
      { reason: 'already_enrolled' },
    );
  return { owner, sessionHash: session.tokenHash };
}

/**
 * Another device: the enrolment token of a device request that an approved device approved, inside
 * its 10 minutes and not used yet. The passkey goes to the owner who approved it. Unknown, pending,
 * declined, expired and used tokens all answer LINK_EXPIRED.
 */
async function tokenEnrolment(
  ctx: Ctx,
  token: string,
): Promise<{ owner: OwnerRow; request: DeviceRequestRow }> {
  const request = await requestByToken(ctx, token);
  if (!request?.user_id || !enrolOpen(request, ctx.now())) fail('LINK_EXPIRED', TOKEN_GONE);
  const owner = await ctx.db.first<OwnerRow>(
    `SELECT id, name, email, passkey_enrolled_at FROM users
      WHERE org_id = ?org AND id = ? AND role = 'owner' AND status = 'active'`,
    request.user_id,
  );
  if (!owner) fail('LINK_EXPIRED', TOKEN_GONE);
  return { owner, request };
}

/** True while an active owner of the salon has no passkey: the sign-in page still offers the email code. */
async function emailCodeOffered(ctx: Ctx): Promise<boolean> {
  const row = await ctx.db.first<{ n: number }>(
    `SELECT COUNT(*) AS n FROM users WHERE org_id = ?org AND role = 'owner' AND status = 'active'
        AND passkey_enrolled_at IS NULL`,
  );
  return (row?.n ?? 0) > 0;
}

export const ownerAccessHandlers: Handlers = {
  ...deviceRequestHandlers,

  // ---- Sign in, and the challenge that confirms a device action ---------------------------------

  async ownerPasskeyOptions({ body }, ctx, c) {
    const rp = ownerRelyingParty(c);
    requireOrg(ctx);
    let allow: PasskeyRow[] = [];
    let bind: { userId: string; sessionHash: string; passkeyId: string } | null = null;
    if (body.purpose === 'confirm') {
      // Approve and Remove: a fingerprint on the device that holds this session, nothing else.
      const session = ctx.session;
      const user = ctx.user;
      if (!session || !user) fail('UNAUTHENTICATED');
      if (user.role !== 'owner') fail('FORBIDDEN');
      if (!session.passkeyId)
        fail('FORBIDDEN', 'Sign in with your fingerprint first.', { reason: 'passkey_session' });
      const own = await ctx.db.first<PasskeyRow>(
        `SELECT ${PASSKEY_COLUMNS} FROM owner_passkeys
          WHERE org_id = ?org AND id = ? AND user_id = ? AND removed_at IS NULL`,
        session.passkeyId,
        user.id,
      );
      if (!own) fail('UNAUTHENTICATED');
      allow = [own];
      bind = { userId: user.id, sessionHash: session.tokenHash, passkeyId: own.id };
    }
    await assertChallengeBudget(ctx);
    const options = await assertionOptions(rp, allow);
    const { challengeId, expiresAt } = await storeChallenge(ctx, {
      purpose: body.purpose,
      challenge: options.challenge,
      ...(bind ?? {}),
    });
    return { challengeId, expiresAt, options, emailCode: await emailCodeOffered(ctx) };
  },

  async ownerPasskeyVerify({ body }, ctx, c) {
    const rp = ownerRelyingParty(c);
    const orgId = requireOrg(ctx);
    const challenge = await claimChallenge(ctx, body.challengeId, 'signin');
    const stored = await ctx.db.first<PasskeyRow & { role: string; status: string }>(
      `SELECT p.id, p.user_id, p.credential_id, p.public_key, p.sign_count, p.transports, p.device_name,
              p.platform, p.created_at, p.last_used_at, u.role, u.status
         FROM owner_passkeys p JOIN users u ON u.id = p.user_id
        WHERE p.org_id = ?org AND p.credential_id = ? AND p.removed_at IS NULL`,
      body.credential.id,
    );
    // Unknown and removed credentials look the same to the caller.
    if (stored?.role !== 'owner' || stored.status !== 'active')
      rejectPasskey(ctx, 'signin', stored ? 'inactive_owner' : 'unknown_credential');
    const counter = await verifyAssertion(
      ctx,
      rp,
      'signin',
      challenge.challenge,
      body.credential,
      stored,
    );
    const now = ctx.now();
    await ctx.db.batch([
      ctx.db.stmt(
        `UPDATE owner_passkeys SET sign_count = MAX(sign_count, ?), last_used_at = ?
          WHERE org_id = ?org AND id = ?`,
        counter,
        now,
        stored.id,
      ),
      ctx.services.audit.stmt(ctx, {
        category: 'security',
        action: 'owner.signin_passkey',
        entity: 'owner_passkey',
        entityId: stored.id,
        after: { deviceName: stored.device_name },
        actorType: 'user',
        actorId: stored.user_id,
      }),
    ]);
    const started = await startUserSession(
      ctx,
      c,
      { id: stored.user_id, orgId, role: 'owner' },
      null,
      stored.id,
    );
    // A passkey sign-in is fresh too: it opens the forgotten-PIN window (services/pin-reset.ts).
    await openPinResetWindow(ctx, started.tokenHash);
    return buildMe(ctx, stored.user_id, { deviceId: null, stepUpUntil: null });
  },

  // ---- Enrolment: the first device after the email code, or a device approved on another ------------

  async ownerEnrolOptions({ body }, ctx, c) {
    const rp = ownerRelyingParty(c);
    requireOrg(ctx);
    let owner: OwnerRow;
    let bind: { sessionHash: string } | { requestId: string };
    if (body.enrolToken !== undefined) {
      const t = await tokenEnrolment(ctx, body.enrolToken);
      owner = t.owner;
      bind = { requestId: t.request.id };
    } else {
      const f = await firstDeviceOwner(ctx);
      owner = f.owner;
      bind = { sessionHash: f.sessionHash };
    }
    await assertChallengeBudget(ctx);
    const options = await registrationOptions(rp, owner, await livePasskeys(ctx, owner.id));
    const { challengeId, expiresAt } = await storeChallenge(ctx, {
      purpose: 'enrol',
      challenge: options.challenge,
      userId: owner.id,
      ...bind,
    });
    return { challengeId, expiresAt, options };
  },

  async ownerEnrolVerify({ body }, ctx, c) {
    const rp = ownerRelyingParty(c);
    const orgId = requireOrg(ctx);
    let owner: OwnerRow;
    let request: DeviceRequestRow | null = null;
    let sessionHash: string | null = null;
    if (body.enrolToken !== undefined)
      ({ owner, request } = await tokenEnrolment(ctx, body.enrolToken));
    else ({ owner, sessionHash } = await firstDeviceOwner(ctx));
    const challenge = await claimChallenge(ctx, body.challengeId, 'enrol');
    // The challenge belongs to this owner and this session or request (not one handed out elsewhere).
    const bound = request
      ? challenge.request_id === request.id
      : challenge.session_hash === sessionHash;
    if (challenge.user_id !== owner.id || !bound)
      fail('NONCE_INVALID', 'That took too long. Try again.');
    const reg = await verifyRegistration(ctx, rp, challenge.challenge, body.credential);
    const taken = await ctx.db.first<{ id: string }>(
      'SELECT id FROM owner_passkeys WHERE org_id = ?org AND credential_id = ?',
      reg.credentialId,
    );
    if (taken) fail('DUPLICATE', 'This passkey is already saved.');

    const now = ctx.now();
    if (request) {
      // The token works once: one conditional UPDATE, so two passkeys cannot come from one approval.
      const claimed = await ctx.db.run(
        `UPDATE owner_device_requests SET used_at = ?
          WHERE org_id = ?org AND id = ? AND status = 'approved' AND used_at IS NULL AND decided_at > ?`,
        now,
        request.id,
        now - ENROL_WINDOW_MS,
      );
      if (claimed.meta.changes !== 1) fail('LINK_EXPIRED', TOKEN_GONE);
    }
    const passkeyId = ulid(now);
    const row: PasskeyRow = {
      id: passkeyId,
      user_id: owner.id,
      credential_id: reg.credentialId,
      public_key: reg.publicKey,
      sign_count: reg.counter,
      transports: JSON.stringify(reg.transports),
      device_name: body.deviceName,
      platform: body.platform,
      created_at: now,
      last_used_at: now,
    };
    const audit = ctx.services.audit.stmt(ctx, {
      category: 'security',
      action: 'owner.passkey_enrolled',
      entity: 'owner_passkey',
      entityId: passkeyId,
      after: {
        deviceName: row.device_name,
        platform: row.platform,
        via: request ? 'device_request' : 'email_code',
        ...(request ? { requestId: request.id } : {}),
        deviceType: reg.deviceType,
        backedUp: reg.backedUp,
      },
      ...(request ? { actorType: 'user' as const, actorId: owner.id } : {}),
    });
    if (request) {
      // Another device of an owner who already has a passkey: nothing else changes.
      await ctx.db.batch([ctx.db.insert('owner_passkeys', { ...row }), audit]);
    } else {
      await ctx.db.batch([
        ctx.db.insert('owner_passkeys', { ...row }),
        ctx.db.stmt(
          `UPDATE users SET passkey_enrolled_at = COALESCE(passkey_enrolled_at, ?), updated_at = ?
            WHERE org_id = ?org AND id = ?`,
          now,
          now,
          owner.id,
        ),
        // From now on only passkey sessions count for this owner: end the email-code ones.
        ctx.db.stmt(
          `UPDATE sessions SET revoked_at = ? WHERE org_id = ?org AND user_id = ? AND revoked_at IS NULL
              AND passkey_id IS NULL`,
          now,
          owner.id,
        ),
        audit,
      ]);
    }
    // Sign-in codes already sent to this owner stop working too.
    if (!request && owner.email)
      await ctx.sys.run(
        'UPDATE magic_links SET used_at = ?1 WHERE email = ?2 AND used_at IS NULL',
        now,
        owner.email,
      );
    const started = await startUserSession(
      ctx,
      c,
      { id: owner.id, orgId, role: 'owner' },
      null,
      passkeyId,
    );
    // The email code plus a new passkey: as fresh as a sign-in (forgotten-PIN window).
    await openPinResetWindow(ctx, started.tokenHash);
    const me = await buildMe(ctx, owner.id, { deviceId: null, stepUpUntil: null });
    return { me, device: deviceView(row, passkeyId) };
  },

  // ---- Approved devices -----------------------------------------------------------------------------

  async ownerDeviceList(_input, ctx, c) {
    ownerRelyingParty(c);
    const user = ctx.user;
    if (!user) fail('UNAUTHENTICATED');
    const rows = await livePasskeys(ctx, user.id);
    const current = ctx.session?.passkeyId ?? null;
    return { devices: rows.map((r) => deviceView(r, current)) };
  },

  async ownerDeviceRename({ params, body }, ctx, c) {
    ownerRelyingParty(c);
    const user = ctx.user;
    if (!user) fail('UNAUTHENTICATED');
    const row = await ctx.db.first<PasskeyRow>(
      `SELECT ${PASSKEY_COLUMNS} FROM owner_passkeys
        WHERE org_id = ?org AND id = ? AND user_id = ? AND removed_at IS NULL`,
      params.id,
      user.id,
    );
    if (!row) fail('NOT_FOUND');
    if (row.device_name !== body.deviceName)
      await ctx.db.batch([
        ctx.db.update('owner_passkeys', { device_name: body.deviceName }, 'id = ?', row.id),
        ctx.services.audit.stmt(ctx, {
          category: 'security',
          action: 'owner.device_renamed',
          entity: 'owner_passkey',
          entityId: row.id,
          before: { deviceName: row.device_name },
          after: { deviceName: body.deviceName },
        }),
      ]);
    return deviceView({ ...row, device_name: body.deviceName }, ctx.session?.passkeyId ?? null);
  },
};
