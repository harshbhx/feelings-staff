/**
 * Owner passkeys (ADR-19, docs/owner-access.md "Passkeys"): the relying party, single-use challenges,
 * WebAuthn options and verification through @simplewebauthn/server, and the stored credentials.
 * Everything here runs on the owner host only; while OWNER_HOST is unset the routes answer 404.
 * Owner: WP-3.
 */
import {
  fromBase64Url,
  type OwnerDeviceView,
  type PasskeyAssertion,
  type PasskeyCreationOptions,
  type PasskeyDescriptor,
  type PasskeyRegistration,
  type PasskeyRequestOptions,
  type Platform,
  toBase64Url,
} from '@fs/contracts';
import {
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialDescriptorJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type { Context } from 'hono';
import { json } from '../db';
import type { AppEnv } from '../lib/app-env';
import { fail } from '../lib/errors';
import { ownerOrigin, surfaceOf } from '../lib/hosts';
import { ulid } from '../lib/ulid';
import type { Ctx } from './ports';

/** Challenges are single use and live 5 minutes. */
export const CHALLENGE_TTL_MS = 5 * 60_000;
/** Challenge budget (every verify uses one up, so this also caps verifies). */
export const CHALLENGES_PER_IP = { max: 20, windowMs: 15 * 60_000 } as const;
export const CHALLENGES_PER_ORG = { max: 200, windowMs: 15 * 60_000 } as const;
/** How long the browser shows its prompt (a hint to the browser). */
const PROMPT_TIMEOUT_MS = 60_000;
/** ES256 and RS256 (COSE algorithm ids). */
export const PASSKEY_ALGORITHMS = [-7, -257];
const RP_NAME = 'Feelings';
const KNOWN_TRANSPORTS: readonly AuthenticatorTransportFuture[] = [
  'ble',
  'cable',
  'hybrid',
  'internal',
  'nfc',
  'smart-card',
  'usb',
];

const PASSKEY_FAILED = "That passkey didn't work. Try again.";
const CHALLENGE_GONE = 'That took too long. Try again.';

export type ChallengePurpose = 'signin' | 'confirm' | 'enrol';

export interface RelyingParty {
  /** The owner host name without a port. */
  id: string;
  /** `https://<owner host>` (http when APP_ORIGIN is http, as in the e2e preview). */
  origin: string;
}

/**
 * The relying party of this request. Anywhere but the owner host (the staff host, or any host while
 * OWNER_HOST is unset) this answers NOT_FOUND, so no passkey route exists there.
 */
export function ownerRelyingParty(c: Context<AppEnv>): RelyingParty {
  if (surfaceOf(c.env, new URL(c.req.url)) !== 'owner') fail('NOT_FOUND');
  const origin = ownerOrigin(c.env);
  return { id: new URL(origin).hostname, origin };
}

/**
 * True when this owner must sign in with a passkey: on the owner host, once a passkey is enrolled,
 * the email code and the password no longer sign them in. Always false off the owner host, without
 * touching the database, so the single-host sign-in stays exactly as it is.
 */
export async function passkeyRequired(
  ctx: Ctx,
  c: Context<AppEnv>,
  ownerId: string,
): Promise<boolean> {
  if (surfaceOf(c.env, new URL(c.req.url)) !== 'owner') return false;
  const row = await ctx.db.first<{ at: number | null }>(
    'SELECT passkey_enrolled_at AS at FROM users WHERE org_id = ?org AND id = ?',
    ownerId,
  );
  return row?.at != null;
}

// ---- Challenges ----------------------------------------------------------------------------------

export interface ChallengeRow {
  id: string;
  purpose: ChallengePurpose;
  challenge: string;
  user_id: string | null;
  session_hash: string | null;
  passkey_id: string | null;
  request_id: string | null;
  expires_at: number;
  used_at: number | null;
}

/** RATE_LIMITED when this IP (or the whole salon) asked for too many challenges lately. */
export async function assertChallengeBudget(ctx: Ctx): Promise<void> {
  const since = ctx.now() - CHALLENGES_PER_IP.windowMs;
  const retry = { 'Retry-After': String(CHALLENGES_PER_IP.windowMs / 1000) };
  if (ctx.ipHmac) {
    const byIp = await ctx.db.first<{ n: number }>(
      'SELECT COUNT(*) AS n FROM owner_passkey_challenges WHERE org_id = ?org AND ip_hmac = ? AND created_at > ?',
      ctx.ipHmac,
      since,
    );
    if ((byIp?.n ?? 0) >= CHALLENGES_PER_IP.max) fail('RATE_LIMITED', undefined, undefined, retry);
  }
  const byOrg = await ctx.db.first<{ n: number }>(
    'SELECT COUNT(*) AS n FROM owner_passkey_challenges WHERE org_id = ?org AND created_at > ?',
    ctx.now() - CHALLENGES_PER_ORG.windowMs,
  );
  if ((byOrg?.n ?? 0) >= CHALLENGES_PER_ORG.max) fail('RATE_LIMITED', undefined, undefined, retry);
}

/** Store a challenge the options just carried. */
export async function storeChallenge(
  ctx: Ctx,
  c: {
    purpose: ChallengePurpose;
    challenge: string;
    userId?: string | null;
    sessionHash?: string | null;
    passkeyId?: string | null;
    requestId?: string | null;
  },
): Promise<{ challengeId: string; expiresAt: number }> {
  const now = ctx.now();
  const challengeId = ulid(now);
  const expiresAt = now + CHALLENGE_TTL_MS;
  await ctx.db
    .insert('owner_passkey_challenges', {
      id: challengeId,
      purpose: c.purpose,
      challenge: c.challenge,
      user_id: c.userId ?? null,
      session_hash: c.sessionHash ?? null,
      passkey_id: c.passkeyId ?? null,
      request_id: c.requestId ?? null,
      ip_hmac: ctx.ipHmac,
      expires_at: expiresAt,
      created_at: now,
    })
    .run();
  return { challengeId, expiresAt };
}

/**
 * Use up a challenge: unknown, used, expired or another purpose answers NONCE_INVALID. The claim
 * is one conditional UPDATE, so two requests with the same challenge cannot both pass.
 */
export async function claimChallenge(
  ctx: Ctx,
  challengeId: string,
  purpose: ChallengePurpose,
): Promise<ChallengeRow> {
  const now = ctx.now();
  const row = await ctx.db.first<ChallengeRow>(
    `SELECT id, purpose, challenge, user_id, session_hash, passkey_id, request_id, expires_at, used_at
       FROM owner_passkey_challenges WHERE org_id = ?org AND id = ?`,
    challengeId,
  );
  if (!row || row.purpose !== purpose || row.used_at !== null || row.expires_at <= now)
    fail('NONCE_INVALID', CHALLENGE_GONE);
  const claimed = await ctx.db.run(
    'UPDATE owner_passkey_challenges SET used_at = ? WHERE org_id = ?org AND id = ? AND used_at IS NULL',
    now,
    challengeId,
  );
  if (claimed.meta.changes !== 1) fail('NONCE_INVALID', CHALLENGE_GONE);
  return row;
}

// ---- Stored passkeys -----------------------------------------------------------------------------

export interface PasskeyRow {
  id: string;
  user_id: string;
  credential_id: string;
  public_key: string;
  sign_count: number;
  transports: string | null;
  device_name: string;
  platform: Platform;
  created_at: number;
  last_used_at: number | null;
}

export const PASSKEY_COLUMNS =
  'id, user_id, credential_id, public_key, sign_count, transports, device_name, platform, created_at, last_used_at';

/** The owner's passkeys that are not removed, oldest first. */
export async function livePasskeys(ctx: Ctx, userId: string): Promise<PasskeyRow[]> {
  return ctx.db.all<PasskeyRow>(
    `SELECT ${PASSKEY_COLUMNS} FROM owner_passkeys
      WHERE org_id = ?org AND user_id = ? AND removed_at IS NULL ORDER BY created_at, id`,
    userId,
  );
}

export function deviceView(row: PasskeyRow, currentPasskeyId: string | null): OwnerDeviceView {
  return {
    id: row.id,
    deviceName: row.device_name,
    platform: row.platform,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    current: row.id === currentPasskeyId,
  };
}

/** Transport hints we know, in a stable order; anything else a browser sends is dropped. */
export function cleanTransports(
  list: readonly string[] | undefined,
): AuthenticatorTransportFuture[] {
  return KNOWN_TRANSPORTS.filter((t) => list?.includes(t));
}

function descriptor(row: PasskeyRow): {
  id: string;
  transports?: AuthenticatorTransportFuture[];
} {
  const transports = cleanTransports(json<string[]>(row.transports, []));
  return transports.length ? { id: row.credential_id, transports } : { id: row.credential_id };
}

// ---- Options -------------------------------------------------------------------------------------

function descriptorView(d: PublicKeyCredentialDescriptorJSON): PasskeyDescriptor {
  return { id: d.id, type: 'public-key', transports: d.transports };
}

function requestOptionsView(o: PublicKeyCredentialRequestOptionsJSON): PasskeyRequestOptions {
  return {
    challenge: o.challenge,
    timeout: o.timeout,
    rpId: o.rpId,
    allowCredentials: o.allowCredentials?.map(descriptorView),
    userVerification: o.userVerification,
  };
}

function creationOptionsView(o: PublicKeyCredentialCreationOptionsJSON): PasskeyCreationOptions {
  const sel = o.authenticatorSelection;
  return {
    rp: { id: o.rp.id, name: o.rp.name },
    user: { id: o.user.id, name: o.user.name, displayName: o.user.displayName },
    challenge: o.challenge,
    pubKeyCredParams: o.pubKeyCredParams.map((p) => ({ type: 'public-key' as const, alg: p.alg })),
    timeout: o.timeout,
    excludeCredentials: o.excludeCredentials?.map(descriptorView),
    authenticatorSelection: sel
      ? {
          authenticatorAttachment: sel.authenticatorAttachment,
          residentKey: sel.residentKey,
          requireResidentKey: sel.requireResidentKey,
          userVerification: sel.userVerification,
        }
      : undefined,
    attestation: o.attestation,
    hints: o.hints,
    extensions: o.extensions ? { ...o.extensions } : undefined,
  };
}

/** Options for `navigator.credentials.get()`: user verification required; `allow` empty = usernameless. */
export async function assertionOptions(
  rp: RelyingParty,
  allow: PasskeyRow[],
): Promise<PasskeyRequestOptions> {
  const options = await generateAuthenticationOptions({
    rpID: rp.id,
    allowCredentials: allow.map(descriptor),
    userVerification: 'required',
    timeout: PROMPT_TIMEOUT_MS,
  });
  return requestOptionsView(options);
}

/**
 * Options for `navigator.credentials.create()`: resident key preferred, user verification required,
 * attestation none, ES256 and RS256, the owner's other passkeys excluded.
 */
export async function registrationOptions(
  rp: RelyingParty,
  owner: { id: string; name: string; email: string | null },
  exclude: PasskeyRow[],
): Promise<PasskeyCreationOptions> {
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rp.id,
    userName: owner.email ?? owner.name,
    userDisplayName: owner.name,
    // The user handle is the user id (not personal data); a new passkey on the same phone replaces the old one there.
    userID: new Uint8Array(new TextEncoder().encode(owner.id)),
    attestationType: 'none',
    excludeCredentials: exclude.map(descriptor),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
    supportedAlgorithmIDs: PASSKEY_ALGORITHMS,
    timeout: PROMPT_TIMEOUT_MS,
  });
  return creationOptionsView(options);
}

// ---- Verification --------------------------------------------------------------------------------

/** A short reason for the log, never the challenge or any key material. */
function reasonOf(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/origin/i.test(m)) return 'origin';
  if (/RP ?ID/i.test(m)) return 'rp_id';
  if (/challenge/i.test(m)) return 'challenge';
  if (/verif/i.test(m)) return 'user_verification';
  if (/present/i.test(m)) return 'user_presence';
  if (/counter/i.test(m)) return 'counter';
  if (/alg/i.test(m)) return 'algorithm';
  if (/type/i.test(m)) return 'type';
  return 'invalid';
}

/** Log why a passkey answer was refused, then answer SIGNATURE_INVALID (the client sees no detail). */
export function rejectPasskey(
  ctx: Ctx,
  step: 'signin' | 'enrol' | 'confirm',
  reason: string,
): never {
  console.warn(
    JSON.stringify({ msg: 'owner.passkey_rejected', requestId: ctx.requestId, step, reason }),
  );
  return fail('SIGNATURE_INVALID', PASSKEY_FAILED);
}

function assertionJson(c: PasskeyAssertion): AuthenticationResponseJSON {
  const r = c.response;
  return {
    id: c.id,
    rawId: c.rawId,
    type: 'public-key',
    clientExtensionResults: {},
    response: {
      clientDataJSON: r.clientDataJSON,
      authenticatorData: r.authenticatorData,
      signature: r.signature,
      ...(r.userHandle ? { userHandle: r.userHandle } : {}),
    },
  };
}

function registrationJson(c: PasskeyRegistration): RegistrationResponseJSON {
  const transports = cleanTransports(c.response.transports);
  return {
    id: c.id,
    rawId: c.rawId,
    type: 'public-key',
    clientExtensionResults: {},
    response: {
      clientDataJSON: c.response.clientDataJSON,
      attestationObject: c.response.attestationObject,
      ...(transports.length ? { transports } : {}),
    },
  };
}

/**
 * Check an assertion against the stored credential: challenge, origin, relying-party id, user
 * presence and verification, signature, and a counter that must grow (skipped when the stored and the
 * received counter are both 0, as synced passkeys report). Returns the new counter.
 */
export async function verifyAssertion(
  ctx: Ctx,
  rp: RelyingParty,
  step: 'signin' | 'confirm',
  challenge: string,
  credential: PasskeyAssertion,
  stored: PasskeyRow,
): Promise<number> {
  let result: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
  try {
    result = await verifyAuthenticationResponse({
      response: assertionJson(credential),
      expectedChallenge: challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      requireUserVerification: true,
      credential: {
        id: stored.credential_id,
        publicKey: fromBase64Url(stored.public_key),
        counter: stored.sign_count,
        transports: cleanTransports(json<string[]>(stored.transports, [])),
      },
    });
  } catch (e) {
    return rejectPasskey(ctx, step, reasonOf(e));
  }
  if (!result.verified || !result.authenticationInfo.userVerified)
    return rejectPasskey(ctx, step, 'signature');
  return result.authenticationInfo.newCounter;
}

export interface VerifiedRegistration {
  credentialId: string;
  publicKey: string;
  counter: number;
  transports: AuthenticatorTransportFuture[];
  deviceType: 'singleDevice' | 'multiDevice';
  backedUp: boolean;
}

/** Check a new credential: challenge, origin, relying-party id, user verification, ES256 or RS256. */
export async function verifyRegistration(
  ctx: Ctx,
  rp: RelyingParty,
  challenge: string,
  credential: PasskeyRegistration,
): Promise<VerifiedRegistration> {
  let result: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
  try {
    result = await verifyRegistrationResponse({
      response: registrationJson(credential),
      expectedChallenge: challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      requireUserVerification: true,
      supportedAlgorithmIDs: PASSKEY_ALGORITHMS,
    });
  } catch (e) {
    return rejectPasskey(ctx, 'enrol', reasonOf(e));
  }
  const info = result.registrationInfo;
  if (!result.verified || !info?.userVerified) return rejectPasskey(ctx, 'enrol', 'invalid');
  // The id the authenticator put in its data must be the one the browser reported.
  if (info.credential.id !== credential.id) return rejectPasskey(ctx, 'enrol', 'credential_id');
  return {
    credentialId: info.credential.id,
    publicKey: toBase64Url(info.credential.publicKey),
    counter: info.credential.counter,
    transports: cleanTransports(credential.response.transports),
    deviceType: info.credentialDeviceType,
    backedUp: info.credentialBackedUp,
  };
}
