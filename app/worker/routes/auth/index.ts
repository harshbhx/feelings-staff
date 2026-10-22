/**
 * Route handlers. Owner: WP-3: setup, join, sign-in, owner auth, step-up, sessions, security,
 * managers, consents, me (PRD 4.1, 9.4 "System and auth", 10.3).
 */
import {
  type ConsentKind,
  type ConsentView,
  normaliseIndianPhone,
  type Permission,
  pinProblem,
} from '@fs/contracts';
import { bool } from '../../db';
import type { Handlers } from '../../lib/api';
import {
  hashPassword,
  PASSWORD_ITERATIONS,
  randomToken,
  verifyDeviceSignature,
} from '../../lib/crypto';
import { fail } from '../../lib/errors';
import { ownerOrigin } from '../../lib/hosts';
import { loadOrg } from '../../lib/settings';
import { ulid } from '../../lib/ulid';
import { revokeSession } from '../../middleware/session';
import {
  buildMe,
  CREDENTIAL_COLUMNS,
  type CredentialRow,
  createMagicLink,
  findOwnerByEmail,
  magicEmail,
  magicLinkAllowed,
  normaliseEmail,
  passwordMatches,
  permissionsFor,
  redeemMagic,
  requireOrg,
  withOrg,
} from '../../services/auth';
import { getDevice, prepareDevice } from '../../services/device';
import {
  assertJoinTriesLeft,
  failWrongCode,
  findInvite,
  type InviteLookup,
  inviteState,
} from '../../services/invite';
import { passkeyRequired } from '../../services/passkey';
import {
  assertNotLocked,
  failForPin,
  newPinHash,
  pinMatches,
  recordPinFailure,
  verifyPinOrThrow,
} from '../../services/pin';
import {
  closePinResetWindowStmt,
  openPinResetWindow,
  pinResetUntil,
  sendPinChangedEmail,
} from '../../services/pin-reset';
import type { Ctx } from '../../services/ports';
import { revokeUserSessionsStmt, startUserSession } from '../../services/session';
import { STEP_UP_MS } from '../../services/stepup';
import { passwordProblem } from './common-passwords';
import { ownerAccessHandlers } from './owner-access';
import { setup } from './setup';

const CHALLENGE_TTL_MS = 5 * 60_000;

/** The owner host after a passkey exists: the email code and the password no longer sign in. */
function failPasskeyRequired(): never {
  return fail('FORBIDDEN', 'Use your fingerprint or Face ID to sign in.', {
    reason: 'passkey_enrolled',
  });
}
const FIRST_PIN_WINDOW_MS = 15 * 60_000;

function phoneOrFail(input: string): string {
  const phone = normaliseIndianPhone(input);
  if (!phone)
    fail('VALIDATION', 'Enter a 10-digit mobile number.', {
      issues: [{ path: 'phone', message: 'Expected an Indian mobile number', code: 'custom' }],
    });
  return phone;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** Phone + typed code -> the matching, still valid invite. Counts wrong codes per phone. */
async function verifiedInvite(
  ctx: Ctx,
  phoneInput: string,
  code: string,
): Promise<{ phone: string; invite: InviteLookup }> {
  const orgId = requireOrg(ctx);
  const phone = phoneOrFail(phoneInput);
  const triesLeft = await assertJoinTriesLeft(ctx, phone);
  const invite = await findInvite(ctx, code);
  if (
    !invite ||
    invite.org_id !== orgId ||
    invite.user_phone !== phone ||
    invite.user_role === 'owner'
  ) {
    return failWrongCode(ctx, phone, triesLeft);
  }
  const state = inviteState(invite, ctx.now());
  if (state === 'used')
    fail('INVITE_EXPIRED', 'This invite was already used. If that was not you, tell the owner.', {
      state,
    });
  if (state === 'expired')
    fail('INVITE_EXPIRED', 'This invite has expired. Ask the owner to send a new one.', { state });
  return { phone, invite };
}

async function selfieRequiredFor(ctx: Ctx, userId: string, orgDefault: boolean): Promise<boolean> {
  const p = await ctx.db.first<{ selfie_required: number | null }>(
    'SELECT selfie_required FROM staff_profiles WHERE org_id = ?org AND user_id = ?',
    userId,
  );
  return p?.selfie_required === null || p?.selfie_required === undefined
    ? orgDefault
    : bool(p.selfie_required);
}

/** Staff or manager by phone in the request's org (never exited). */
async function staffByPhone(ctx: Ctx, phoneInput: string): Promise<CredentialRow | null> {
  const phone = normaliseIndianPhone(phoneInput);
  if (!phone) return null;
  return ctx.db.first<CredentialRow>(
    `SELECT ${CREDENTIAL_COLUMNS} FROM users
      WHERE org_id = ?org AND phone_e164 = ? AND role IN ('staff', 'manager') AND status <> 'exited'`,
    phone,
  );
}

const NO_MATCH = "That phone number or PIN doesn't match.";
const OWNER_NO_MATCH = "That email, password or PIN doesn't match.";

/** Unknown phone: same work as a real check, same answer as a wrong PIN, no tries count. */
async function failUnknownPerson(ctx: Ctx, pin: string, message = NO_MATCH): Promise<never> {
  await pinMatches(ctx, null, pin);
  return fail('PIN_WRONG', message);
}

function assertCanSignIn(u: CredentialRow): void {
  if (u.status === 'suspended' || u.status === 'exited') fail('ACCOUNT_INACTIVE');
  if (!u.pin_hash)
    fail('ACCOUNT_INACTIVE', 'Use the code the owner sent you to set your PIN.', {
      reason: 'pin_not_set',
    });
}

async function ownerCredentials(ctx: Ctx): Promise<CredentialRow> {
  const userId = ctx.user?.id;
  if (!userId) fail('UNAUTHENTICATED');
  const row = await ctx.db.first<CredentialRow>(
    `SELECT ${CREDENTIAL_COLUMNS} FROM users WHERE org_id = ?org AND id = ?`,
    userId,
  );
  if (!row) fail('UNAUTHENTICATED');
  return row;
}

async function securityView(ctx: Ctx) {
  const u = await ownerCredentials(ctx);
  const now = ctx.now();
  const sessions = await ctx.db.all<{
    token_hash: string;
    created_at: number;
    last_seen_at: number;
  }>(
    `SELECT token_hash, created_at, last_seen_at FROM sessions
      WHERE org_id = ?org AND user_id = ? AND revoked_at IS NULL AND expires_at > ?
      ORDER BY last_seen_at DESC LIMIT 20`,
    u.id,
    now,
  );
  const current = ctx.session?.tokenHash;
  return {
    email: u.email ?? '',
    passwordSet: u.password_hash !== null,
    pinSet: u.pin_hash !== null,
    pinResetUntil: await pinResetUntil(ctx, u),
    sessions: sessions.map((s) => ({
      id: s.token_hash.slice(0, 12),
      current: s.token_hash === current,
      createdAt: s.created_at,
      lastSeenAt: s.last_seen_at,
      label: s.token_hash === current ? 'This device' : 'Another device',
    })),
  };
}

function consentView(r: {
  kind: ConsentKind;
  version: string;
  lang: string;
  accepted_at: number;
  withdrawn_at: number | null;
}): ConsentView {
  return {
    kind: r.kind,
    version: r.version,
    lang: r.lang,
    acceptedAt: r.accepted_at,
    withdrawnAt: r.withdrawn_at,
  };
}

function currentMe(ctx: Ctx) {
  const user = ctx.user;
  const session = ctx.session;
  if (!user || !session) fail('UNAUTHENTICATED');
  return buildMe(ctx, user.id, { deviceId: session.deviceId, stepUpUntil: session.stepUpUntil });
}

export const handlers: Handlers = {
  setup,
  ...ownerAccessHandlers,

  // ---- Invite page and join (PRD 4.1.3, 4.1.4) ----------------------------------------------------

  async joinLookup({ query }, ctx) {
    const invite = await findInvite(ctx, query.code);
    if (!invite)
      return {
        status: 'unknown' as const,
        staffFirstName: null,
        orgName: null,
        ownerDisplayName: null,
        ownerPhone: null,
      };
    const octx = withOrg(ctx, invite.org_id);
    const [{ org }, owner] = await Promise.all([
      loadOrg(octx),
      octx.db.first<{ phone_e164: string | null }>(
        "SELECT phone_e164 FROM users WHERE org_id = ?org AND role = 'owner' AND status = 'active' LIMIT 1",
      ),
    ]);
    const status = inviteState(invite, ctx.now());
    return {
      status,
      staffFirstName: status === 'valid' ? firstName(invite.user_name) : null,
      orgName: org.name,
      ownerDisplayName: org.owner_display_name,
      ownerPhone: owner?.phone_e164 ?? org.phone_e164,
    };
  },

  async joinVerify({ body }, ctx) {
    const { invite } = await verifiedInvite(ctx, body.phone, body.code);
    const octx = withOrg(ctx, invite.org_id);
    const { org, settings } = await loadOrg(octx);
    const selfie = await selfieRequiredFor(
      octx,
      invite.user_id,
      settings.attendance.selfieOnCheckIn,
    );
    return {
      staffFirstName: firstName(invite.user_name),
      orgName: org.name,
      ownerDisplayName: org.owner_display_name,
      lang: invite.user_lang,
      consentsRequired: selfie
        ? ['privacy_notice' as const, 'selfie' as const]
        : ['privacy_notice' as const],
      privacyNoticeVersion: settings.privacy.noticeVersion,
    };
  },

  async joinComplete({ body }, ctx, c) {
    const { phone, invite } = await verifiedInvite(ctx, body.phone, body.code);
    const octx = withOrg(ctx, invite.org_id);
    const { settings } = await loadOrg(octx);
    const problem = pinProblem(body.pin, phone);
    if (problem)
      fail('RULE_VIOLATION', "Pick a PIN that's harder to guess.", {
        field: 'pin',
        pinProblem: problem,
      });
    const selfie = await selfieRequiredFor(
      octx,
      invite.user_id,
      settings.attendance.selfieOnCheckIn,
    );
    const notice = settings.privacy.noticeVersion;
    const missing: ConsentKind[] = [];
    if (!body.consents.some((x) => x.kind === 'privacy_notice' && x.version === notice))
      missing.push('privacy_notice');
    if (selfie && !body.consents.some((x) => x.kind === 'selfie')) missing.push('selfie');
    if (missing.length > 0)
      fail('RULE_VIOLATION', 'Please read and accept the notice first.', {
        consentsRequired: missing,
      });

    const device = await prepareDevice(octx, {
      userId: invite.user_id,
      jwk: body.deviceJwk,
      label: body.deviceLabel,
      platform: body.platform,
    });
    const now = ctx.now();
    const claimed = await octx.db.run(
      `UPDATE invites SET used_at = ? WHERE org_id = ?org AND id = ? AND used_at IS NULL
          AND revoked_at IS NULL AND expires_at > ?`,
      now,
      invite.id,
      now,
    );
    if (claimed.meta.changes !== 1)
      fail('INVITE_EXPIRED', 'This invite was already used.', { state: 'used' });

    const pin = await newPinHash(octx, body.pin);
    const audit = octx.services.audit;
    const seen = new Set<string>();
    const consentStmts = body.consents
      .filter((x) => {
        const k = `${x.kind}:${x.version}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .map((x) =>
        octx.db.insert('consents', {
          id: ulid(now),
          user_id: invite.user_id,
          kind: x.kind,
          version: x.version,
          lang: x.lang,
          accepted_at: now,
        }),
      );
    await octx.db.batch([
      ...device.stmts,
      octx.db.update(
        'users',
        {
          pin_hash: pin.hash,
          pin_salt: pin.salt,
          pin_set_at: now,
          pin_failures: 0,
          pin_failures_24h: 0,
          pin_window_start: null,
          pin_locked_until: null,
          status: 'active',
          updated_at: now,
        },
        'id = ?',
        invite.user_id,
      ),
      ...consentStmts,
      audit.stmt(octx, {
        category: 'security',
        action: invite.purpose === 'pin_reset' ? 'auth.pin_reset_redeemed' : 'auth.join',
        entity: 'user',
        entityId: invite.user_id,
        after: { inviteId: invite.id, deviceId: device.id, consents: [...seen] },
        actorType: 'user',
        actorId: invite.user_id,
      }),
      audit.stmt(octx, {
        category: 'security',
        action: 'device.enrol',
        entity: 'device',
        entityId: device.id,
        after: {
          userId: invite.user_id,
          label: body.deviceLabel,
          platform: body.platform,
          status: device.status,
          reused: device.reused,
          storagePersisted: body.storagePersisted,
        },
        actorType: 'user',
        actorId: invite.user_id,
      }),
    ]);

    await startUserSession(
      octx,
      c,
      { id: invite.user_id, orgId: invite.org_id, role: invite.user_role },
      device.id,
    );
    if (device.status === 'pending' && !device.reused) {
      await octx.services.notifier.emit(octx, {
        type: 'new_device',
        orgId: invite.org_id,
        at: now,
        userId: invite.user_id,
        name: invite.user_name,
        deviceId: device.id,
        deviceLabel: body.deviceLabel,
      });
    }
    return buildMe(octx, invite.user_id, { deviceId: device.id, stepUpUntil: null });
  },

  // ---- Staff sign-in (PRD 4.1.6) -------------------------------------------------------------------

  async authChallenge(_input, ctx) {
    requireOrg(ctx);
    const now = ctx.now();
    const nonce = randomToken(32);
    const expiresAt = now + CHALLENGE_TTL_MS;
    await ctx.db.insert('challenges', { nonce, purpose: 'login', expires_at: expiresAt }).run();
    return { nonce, expiresAt };
  },

  async staffLogin({ body }, ctx, c) {
    const orgId = requireOrg(ctx);
    const now = ctx.now();
    const claimed = await ctx.db.run(
      `UPDATE challenges SET used_at = ? WHERE org_id = ?org AND nonce = ? AND purpose = 'login'
          AND used_at IS NULL AND expires_at > ?`,
      now,
      body.nonce,
      now,
    );
    if (claimed.meta.changes !== 1) fail('NONCE_INVALID');
    const user = await staffByPhone(ctx, body.phone);
    if (!user) return failUnknownPerson(ctx, body.pin);
    if (user.status === 'suspended') fail('ACCOUNT_INACTIVE');

    const device = await getDevice(ctx, body.deviceId);
    if (!device || device.user_id !== user.id)
      fail('DEVICE_NOT_APPROVED', "This phone isn't registered for this number.", {
        deviceStatus: 'unknown',
      });
    const jwk = JSON.parse(device.public_jwk) as JsonWebKey;
    if (!(await verifyDeviceSignature(jwk, body.nonce, body.signature))) {
      await ctx.services.audit.log(ctx, {
        category: 'security',
        action: 'auth.signature_invalid',
        entity: 'device',
        entityId: device.id,
        actorType: 'user',
        actorId: null,
      });
      fail('SIGNATURE_INVALID');
    }
    if (device.status !== 'approved')
      fail(
        'DEVICE_NOT_APPROVED',
        device.status === 'pending'
          ? 'This phone is waiting for approval.'
          : "This phone isn't approved. Talk to the owner.",
        { deviceStatus: device.status },
      );
    assertCanSignIn(user);
    await verifyPinOrThrow(ctx, user, body.pin);

    await ctx.db.batch([
      ctx.db.update('devices', { last_seen_at: now }, 'id = ?', device.id),
      ctx.services.audit.stmt(ctx, {
        category: 'security',
        action: 'auth.staff_login',
        entity: 'user',
        entityId: user.id,
        after: { deviceId: device.id },
        actorType: 'user',
        actorId: user.id,
      }),
    ]);
    await startUserSession(ctx, c, { id: user.id, orgId, role: user.role }, device.id);
    return buildMe(ctx, user.id, { deviceId: device.id, stepUpUntil: null });
  },

  async staffNewDevice({ body }, ctx) {
    const orgId = requireOrg(ctx);
    const user = await staffByPhone(ctx, body.phone);
    if (!user) return failUnknownPerson(ctx, body.pin);
    assertCanSignIn(user);
    await verifyPinOrThrow(ctx, user, body.pin);
    const device = await prepareDevice(ctx, {
      userId: user.id,
      jwk: body.deviceJwk,
      label: body.deviceLabel,
      platform: body.platform,
    });
    const now = ctx.now();
    await ctx.db.batch([
      ...device.stmts,
      ctx.services.audit.stmt(ctx, {
        category: 'security',
        action: 'device.enrol',
        entity: 'device',
        entityId: device.id,
        after: {
          userId: user.id,
          label: body.deviceLabel,
          platform: body.platform,
          status: device.status,
          reused: device.reused,
          via: 'new_device',
        },
        actorType: 'user',
        actorId: user.id,
      }),
    ]);
    if (!device.reused) {
      await ctx.services.notifier.emit(ctx, {
        type: 'new_device',
        orgId,
        at: now,
        userId: user.id,
        name: user.name,
        deviceId: device.id,
        deviceLabel: body.deviceLabel,
      });
    }
    return { status: 'pending' as const, deviceId: device.id };
  },

  // ---- Owner sign-in (PRD 4.1.7) -------------------------------------------------------------------

  async ownerMagic({ body }, ctx, c) {
    const email = normaliseEmail(body.email);
    const owner = await findOwnerByEmail(ctx, email);
    // On the owner host an owner with a passkey gets no email code (still 202: no account enumeration).
    if (owner && (await passkeyRequired(withOrg(ctx, owner.org_id), c, owner.id))) {
      console.info(JSON.stringify({ msg: 'auth.magic_refused_passkey', requestId: ctx.requestId }));
      return undefined;
    }
    if (owner && (await magicLinkAllowed(ctx, email))) {
      const octx = withOrg(ctx, owner.org_id);
      const link = await createMagicLink(octx, email);
      const mail = magicEmail({
        origin: ownerOrigin(ctx.env),
        name: owner.name,
        token: link.token,
        code: link.code,
      });
      try {
        await octx.services.email.send(octx, { to: email, subject: mail.subject, text: mail.text });
      } catch (err) {
        // Always 202 (no account enumeration), but say why the mail did not go out.
        console.error(
          JSON.stringify({
            msg: 'auth.magic_email_failed',
            requestId: ctx.requestId,
            provider: ctx.env.EMAIL_PROVIDER,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
      await octx.services.audit.log(octx, {
        category: 'security',
        action: 'auth.magic_requested',
        entity: 'user',
        entityId: owner.id,
        actorType: 'user',
        actorId: null,
      });
    }
    return undefined;
  },

  async ownerVerify({ body }, ctx, c) {
    const email = await redeemMagic(ctx, body);
    const owner = await findOwnerByEmail(ctx, email);
    if (!owner) fail('LINK_EXPIRED', 'This link has expired. Send a new one.');
    const octx = withOrg(ctx, owner.org_id);
    if (await passkeyRequired(octx, c, owner.id)) failPasskeyRequired();
    const now = ctx.now();
    await octx.db.batch([
      // A magic-link sign-in also lifts an owner PIN lock (PRD 4.1.7).
      octx.db.update(
        'users',
        { pin_failures: 0, pin_locked_until: null, updated_at: now },
        'id = ?',
        owner.id,
      ),
      octx.services.audit.stmt(octx, {
        category: 'security',
        action: 'auth.owner_login',
        entity: 'user',
        entityId: owner.id,
        after: { method: 'token' in body ? 'link' : 'code' },
        actorType: 'user',
        actorId: owner.id,
      }),
    ]);
    const started = await startUserSession(
      octx,
      c,
      { id: owner.id, orgId: owner.org_id, role: 'owner' },
      null,
    );
    // A fresh email sign-in opens the forgotten-PIN window for 15 minutes (services/pin-reset.ts).
    await openPinResetWindow(octx, started.tokenHash);
    return buildMe(octx, owner.id, { deviceId: null, stepUpUntil: null });
  },

  async ownerPassword({ body }, ctx, c) {
    const owner = await findOwnerByEmail(ctx, body.email);
    if (!owner?.password_hash) {
      await passwordMatches(ctx, null, body.password);
      fail('PIN_WRONG', OWNER_NO_MATCH);
    }
    const octx = withOrg(ctx, owner.org_id);
    assertNotLocked(octx, owner);
    if (!(await passwordMatches(octx, owner, body.password))) {
      const r = await recordPinFailure(octx, owner, 'password');
      if (r.locked) failForPin(r);
      fail('PIN_WRONG', OWNER_NO_MATCH);
    }
    if (!owner.pin_hash) fail('PIN_WRONG', OWNER_NO_MATCH);
    await verifyPinOrThrow(octx, owner, body.pin);
    if (await passkeyRequired(octx, c, owner.id)) failPasskeyRequired();
    await octx.services.audit.log(octx, {
      category: 'security',
      action: 'auth.owner_login',
      entity: 'user',
      entityId: owner.id,
      after: { method: 'password' },
      actorType: 'user',
      actorId: owner.id,
    });
    // Never opens the forgotten-PIN window: a password alone must not replace the PIN.
    await startUserSession(octx, c, { id: owner.id, orgId: owner.org_id, role: 'owner' }, null);
    return buildMe(octx, owner.id, { deviceId: null, stepUpUntil: null });
  },

  // ---- Step-up, logout, me ------------------------------------------------------------------------

  async stepUp({ body }, ctx) {
    const session = ctx.session;
    if (!session) fail('UNAUTHENTICATED');
    const u = await ownerCredentials(ctx);
    if (!u.pin_hash)
      fail('RULE_VIOLATION', 'Set your PIN in Settings, Security first.', { pinSet: false });
    await verifyPinOrThrow(ctx, u, body.pin);
    const stepUpUntil = ctx.now() + STEP_UP_MS;
    await ctx.db.batch([
      ctx.db.stmt(
        'UPDATE sessions SET step_up_until = ? WHERE org_id = ?org AND token_hash = ?',
        stepUpUntil,
        session.tokenHash,
      ),
      ctx.services.audit.stmt(ctx, {
        category: 'security',
        action: 'auth.step_up',
        entity: 'user',
        entityId: u.id,
        after: { stepUpUntil },
      }),
    ]);
    return { stepUpUntil };
  },

  async logout(_input, ctx, c) {
    const session = ctx.session;
    if (!session) fail('UNAUTHENTICATED');
    await revokeSession(ctx, c, session.tokenHash);
    await ctx.services.audit.log(ctx, {
      category: 'security',
      action: 'auth.logout',
      entity: session.kind === 'door' ? 'door_device' : 'user',
      entityId: session.kind === 'door' ? session.deviceId : session.userId,
    });
    return undefined;
  },

  async me(_input, ctx) {
    return currentMe(ctx);
  },

  async mePatch({ body }, ctx) {
    const user = ctx.user;
    if (!user) fail('UNAUTHENTICATED');
    if (body.name !== undefined && user.role !== 'owner')
      fail('FORBIDDEN', 'Ask the owner to change your name.');
    const set: Record<string, string | number> = {};
    const before: Record<string, string> = {};
    if (body.lang !== undefined && body.lang !== user.lang) {
      set.lang = body.lang;
      before.lang = user.lang;
    }
    if (body.name !== undefined && body.name.trim() !== user.name) {
      set.name = body.name.trim();
      before.name = user.name;
    }
    if (Object.keys(set).length > 0) {
      const after = { ...set };
      set.updated_at = ctx.now();
      await ctx.db.batch([
        ctx.db.update('users', set, 'id = ?', user.id),
        ctx.services.audit.stmt(ctx, {
          category: 'change',
          action: 'user.update_self',
          entity: 'user',
          entityId: user.id,
          before,
          after,
        }),
      ]);
    }
    return currentMe(ctx);
  },

  // ---- Consents (PRD 10.6) -------------------------------------------------------------------------

  async consentGive({ body }, ctx) {
    const user = ctx.user;
    if (!user) fail('UNAUTHENTICATED');
    const { settings } = await loadOrg(ctx);
    if (body.kind === 'privacy_notice' && body.version !== settings.privacy.noticeVersion)
      fail('RULE_VIOLATION', 'This notice has a newer version. Reload and read it again.', {
        noticeVersion: settings.privacy.noticeVersion,
      });
    const existing = await ctx.db.first<{
      kind: ConsentKind;
      version: string;
      lang: string;
      accepted_at: number;
      withdrawn_at: number | null;
    }>(
      `SELECT kind, version, lang, accepted_at, withdrawn_at FROM consents
        WHERE org_id = ?org AND user_id = ? AND kind = ? AND version = ? AND withdrawn_at IS NULL
        ORDER BY accepted_at DESC LIMIT 1`,
      user.id,
      body.kind,
      body.version,
    );
    if (existing) return consentView(existing);
    const now = ctx.now();
    const id = ulid(now);
    await ctx.db.batch([
      ctx.db.insert('consents', {
        id,
        user_id: user.id,
        kind: body.kind,
        version: body.version,
        lang: body.lang,
        accepted_at: now,
      }),
      ctx.services.audit.stmt(ctx, {
        category: 'change',
        action: 'consent.give',
        entity: 'consent',
        entityId: id,
        after: { kind: body.kind, version: body.version, lang: body.lang },
      }),
    ]);
    return consentView({
      kind: body.kind,
      version: body.version,
      lang: body.lang,
      accepted_at: now,
      withdrawn_at: null,
    });
  },

  async consentWithdraw({ params }, ctx) {
    const user = ctx.user;
    if (!user) fail('UNAUTHENTICATED');
    if (params.kind === 'privacy_notice' || params.kind === 'fines_notice')
      fail('RULE_VIOLATION', 'A notice is an acknowledgement and cannot be withdrawn.', {
        kind: params.kind,
      });
    const row = await ctx.db.first<{
      id: string;
      kind: ConsentKind;
      version: string;
      lang: string;
      accepted_at: number;
      withdrawn_at: number | null;
    }>(
      `SELECT id, kind, version, lang, accepted_at, withdrawn_at FROM consents
        WHERE org_id = ?org AND user_id = ? AND kind = ? AND withdrawn_at IS NULL
        ORDER BY accepted_at DESC LIMIT 1`,
      user.id,
      params.kind,
    );
    if (!row) fail('NOT_FOUND');
    const now = ctx.now();
    await ctx.db.batch([
      ctx.db.stmt(
        'UPDATE consents SET withdrawn_at = ? WHERE org_id = ?org AND user_id = ? AND kind = ? AND withdrawn_at IS NULL',
        now,
        user.id,
        params.kind,
      ),
      ctx.services.audit.stmt(ctx, {
        category: 'change',
        action: 'consent.withdraw',
        entity: 'consent',
        entityId: row.id,
        before: { kind: row.kind, version: row.version },
        after: { withdrawnAt: now },
      }),
    ]);
    return consentView({ ...row, withdrawn_at: now });
  },

  // ---- Owner security (PRD 4.1.7, Settings -> Security) ---------------------------------------------

  async ownerSecurityGet(_input, ctx) {
    return securityView(ctx);
  },

  async ownerSetPassword({ body }, ctx) {
    const u = await ownerCredentials(ctx);
    const problem = passwordProblem(body.password, u.email);
    if (problem)
      fail(
        'RULE_VIOLATION',
        problem === 'personal'
          ? "Don't use your email in the password."
          : 'That password is too easy to guess. Try a longer phrase.',
        { field: 'password', passwordProblem: problem },
      );
    if (!u.pin_hash)
      fail('RULE_VIOLATION', 'Set your PIN first, then the password.', { pinSet: false });
    await verifyPinOrThrow(ctx, u, body.pin);
    const now = ctx.now();
    const salt = randomToken(16);
    const hash = await hashPassword(ctx.env.PIN_PEPPER, salt, body.password, PASSWORD_ITERATIONS);
    await ctx.db.batch([
      ctx.db.update(
        'users',
        {
          password_hash: hash,
          password_salt: salt,
          password_iter: PASSWORD_ITERATIONS,
          updated_at: now,
        },
        'id = ?',
        u.id,
      ),
      ctx.services.audit.stmt(ctx, {
        category: 'security',
        action: u.password_hash ? 'owner.password_change' : 'owner.password_set',
        entity: 'user',
        entityId: u.id,
      }),
    ]);
    return securityView(ctx);
  },

  async ownerSetPin({ body }, ctx) {
    const u = await ownerCredentials(ctx);
    const session = ctx.session;
    if (!session) fail('UNAUTHENTICATED');
    // Forgotten PIN: no current PIN, allowed only inside the window the server derives from this
    // session (fresh email sign-in, 15 minutes, once; docs/owner-access.md, Passkeys flow 6).
    let reset = false;
    if (u.pin_hash) {
      if (body.currentPin) await verifyPinOrThrow(ctx, u, body.currentPin);
      else if ((await pinResetUntil(ctx, u)) !== null) reset = true;
      else
        fail(
          'RULE_VIOLATION',
          'Enter your current PIN. Forgot it? Sign in again with a code from your email, then set a new one.',
          { reason: 'recent_sign_in_required' },
        );
    } else if (ctx.now() - session.createdAt > FIRST_PIN_WINDOW_MS) {
      fail('RULE_VIOLATION', 'For your safety, sign in again, then set your PIN.', {
        reason: 'recent_sign_in_required',
      });
    }
    const problem = pinProblem(body.pin, u.phone_e164);
    if (problem)
      fail('RULE_VIOLATION', "Pick a PIN that's harder to guess.", {
        field: 'pin',
        pinProblem: problem,
      });
    const now = ctx.now();
    const pin = await newPinHash(ctx, body.pin);
    await ctx.db.batch([
      ctx.db.update(
        'users',
        {
          pin_hash: pin.hash,
          pin_salt: pin.salt,
          pin_set_at: now,
          pin_failures: 0,
          pin_locked_until: null,
          updated_at: now,
        },
        'id = ?',
        u.id,
      ),
      // Any PIN write closes this session's reset window (one reset per sign-in); a reset also
      // signs out every other session of the owner (this one stays).
      closePinResetWindowStmt(ctx, session.tokenHash),
      ...(reset ? [revokeUserSessionsStmt(ctx, u.id, session.tokenHash)] : []),
      ctx.services.audit.stmt(ctx, {
        category: 'security',
        action: reset ? 'owner.pin_reset' : u.pin_hash ? 'owner.pin_change' : 'owner.pin_set',
        entity: 'user',
        entityId: u.id,
        ...(reset ? { after: { otherSessionsRevoked: true } } : {}),
      }),
    ]);
    if (reset) await sendPinChangedEmail(ctx, u);
    return securityView(ctx);
  },

  async ownerSignOutOthers(_input, ctx) {
    const user = ctx.user;
    const session = ctx.session;
    if (!user || !session) fail('UNAUTHENTICATED');
    await ctx.db.batch([
      revokeUserSessionsStmt(ctx, user.id, session.tokenHash),
      ctx.services.audit.stmt(ctx, {
        category: 'security',
        action: 'auth.sign_out_others',
        entity: 'user',
        entityId: user.id,
      }),
    ]);
    return securityView(ctx);
  },

  // ---- Managers (P1, PRD 10.2) ----------------------------------------------------------------------

  async ownerManagersList(_input, ctx) {
    const rows = await ctx.db.all<{
      id: string;
      name: string;
      phone_e164: string | null;
      permissions_json: string | null;
      designation: string | null;
    }>(
      `SELECT u.id, u.name, u.phone_e164, u.permissions_json, p.designation
         FROM users u LEFT JOIN staff_profiles p ON p.user_id = u.id
        WHERE u.org_id = ?org AND u.role = 'manager' AND u.status <> 'exited'
        ORDER BY u.name`,
    );
    return rows.map((r) => managerView(r));
  },

  async ownerManagerUpsert({ body }, ctx) {
    const row = await ctx.db.first<{
      id: string;
      name: string;
      role: string;
      status: string;
      phone_e164: string | null;
      permissions_json: string | null;
      designation: string | null;
    }>(
      `SELECT u.id, u.name, u.role, u.status, u.phone_e164, u.permissions_json, p.designation
         FROM users u LEFT JOIN staff_profiles p ON p.user_id = u.id
        WHERE u.org_id = ?org AND u.id = ?`,
      body.userId,
    );
    if (!row || row.role === 'owner') fail('NOT_FOUND');
    if (row.status === 'exited') fail('RULE_VIOLATION', 'This person has left. Rehire them first.');
    const permissions: Permission[] = [...new Set(body.permissions)].sort();
    const now = ctx.now();
    await ctx.db.batch([
      ctx.db.update(
        'users',
        { role: 'manager', permissions_json: JSON.stringify(permissions), updated_at: now },
        'id = ?',
        row.id,
      ),
      ctx.services.audit.stmt(ctx, {
        category: 'change',
        action: 'manager.upsert',
        entity: 'user',
        entityId: row.id,
        before: { role: row.role, permissions: row.permissions_json },
        after: { role: 'manager', permissions },
      }),
    ]);
    return managerView({ ...row, permissions_json: JSON.stringify(permissions) });
  },

  async ownerManagerRemove({ params }, ctx) {
    const row = await ctx.db.first<{ id: string; role: string; permissions_json: string | null }>(
      'SELECT id, role, permissions_json FROM users WHERE org_id = ?org AND id = ?',
      params.id,
    );
    if (row?.role !== 'manager') fail('NOT_FOUND');
    await ctx.db.batch([
      ctx.db.update(
        'users',
        { role: 'staff', permissions_json: null, updated_at: ctx.now() },
        'id = ?',
        row.id,
      ),
      ctx.services.audit.stmt(ctx, {
        category: 'change',
        action: 'manager.remove',
        entity: 'user',
        entityId: row.id,
        before: { role: 'manager', permissions: row.permissions_json },
        after: { role: 'staff' },
      }),
    ]);
    return undefined;
  },
};

function managerView(r: {
  id: string;
  name: string;
  phone_e164: string | null;
  permissions_json: string | null;
  designation: string | null;
}) {
  return {
    user: { id: r.id, name: r.name, designation: r.designation, phone: r.phone_e164 },
    permissions: permissionsFor('manager', r.permissions_json),
    // Per-person scoping is not stored in v1; managers act on everyone.
    staffIds: [],
  };
}
