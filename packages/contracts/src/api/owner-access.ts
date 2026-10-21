/**
 * Owner access on its own host: passkeys, approved devices and recovery (ADR-19,
 * docs/owner-access.md). Every endpoint using these schemas answers only on the owner host.
 *
 * The WebAuthn shapes are the W3C WebAuthn Level 3 JSON forms (`PublicKeyCredential.toJSON()`,
 * `parseCreationOptionsFromJSON`), the same ones `@simplewebauthn/server` reads and writes. Binary
 * fields are base64url. Unknown extra fields are accepted, because browsers add new ones.
 */
import { z } from 'zod';
import { Platform } from '../enums';
import { Base64Url, EpochMs, Id } from '../primitives';
import { Me } from './auth';

// ---- WebAuthn JSON ------------------------------------------------------------------------------

const UserVerification = z.enum(['discouraged', 'preferred', 'required']);
const AuthenticatorAttachment = z.enum(['platform', 'cross-platform']);

/** Transport hints (`internal`, `hybrid`, `usb`, ...). Free strings: the list keeps growing. */
export const PasskeyTransports = z.array(z.string().min(1).max(20)).max(8);

/** A credential id with its transports, in allow and exclude lists. */
export const PasskeyDescriptor = z.object({
  id: Base64Url,
  type: z.literal('public-key'),
  transports: PasskeyTransports.optional(),
});
export type PasskeyDescriptor = z.infer<typeof PasskeyDescriptor>;

/** Options for `navigator.credentials.create()` (registration). */
export const PasskeyCreationOptions = z.object({
  rp: z.object({ id: z.string().optional(), name: z.string() }),
  user: z.object({ id: Base64Url, name: z.string(), displayName: z.string() }),
  challenge: Base64Url,
  pubKeyCredParams: z.array(z.object({ type: z.literal('public-key'), alg: z.number().int() })),
  timeout: z.number().int().positive().optional(),
  excludeCredentials: z.array(PasskeyDescriptor).optional(),
  authenticatorSelection: z
    .object({
      authenticatorAttachment: AuthenticatorAttachment.optional(),
      residentKey: z.enum(['discouraged', 'preferred', 'required']).optional(),
      requireResidentKey: z.boolean().optional(),
      userVerification: UserVerification.optional(),
    })
    .optional(),
  attestation: z.enum(['none', 'indirect', 'direct', 'enterprise']).optional(),
  hints: z.array(z.string()).optional(),
  extensions: z.record(z.string(), z.unknown()).optional(),
});
export type PasskeyCreationOptions = z.infer<typeof PasskeyCreationOptions>;

/** Options for `navigator.credentials.get()` (assertion). */
export const PasskeyRequestOptions = z.object({
  challenge: Base64Url,
  timeout: z.number().int().positive().optional(),
  rpId: z.string().optional(),
  allowCredentials: z.array(PasskeyDescriptor).optional(),
  userVerification: UserVerification.optional(),
  hints: z.array(z.string()).optional(),
  extensions: z.record(z.string(), z.unknown()).optional(),
});
export type PasskeyRequestOptions = z.infer<typeof PasskeyRequestOptions>;

/** Credential ids are at most 1023 bytes (1364 base64url characters). */
const CredentialId = Base64Url.min(16).max(1364);
const ClientExtensionResults = z.record(z.string(), z.unknown());

/** The browser's answer to `create()` (`RegistrationResponseJSON`). */
export const PasskeyRegistration = z.object({
  id: CredentialId,
  rawId: CredentialId,
  type: z.literal('public-key'),
  authenticatorAttachment: AuthenticatorAttachment.nullable().optional(),
  clientExtensionResults: ClientExtensionResults.optional(),
  response: z.object({
    clientDataJSON: Base64Url.min(1).max(8_000),
    attestationObject: Base64Url.min(1).max(32_000),
    authenticatorData: Base64Url.max(16_000).optional(),
    transports: PasskeyTransports.optional(),
    publicKeyAlgorithm: z.number().int().optional(),
    publicKey: Base64Url.max(4_000).optional(),
  }),
});
export type PasskeyRegistration = z.infer<typeof PasskeyRegistration>;

/** The browser's answer to `get()` (`AuthenticationResponseJSON`). */
export const PasskeyAssertion = z.object({
  id: CredentialId,
  rawId: CredentialId,
  type: z.literal('public-key'),
  authenticatorAttachment: AuthenticatorAttachment.nullable().optional(),
  clientExtensionResults: ClientExtensionResults.optional(),
  response: z.object({
    clientDataJSON: Base64Url.min(1).max(8_000),
    authenticatorData: Base64Url.min(1).max(16_000),
    signature: Base64Url.min(1).max(2_000),
    userHandle: Base64Url.max(200).nullable().optional(),
  }),
});
export type PasskeyAssertion = z.infer<typeof PasskeyAssertion>;

// ---- Tokens and codes -----------------------------------------------------------------------------

/**
 * Lets one device create its passkey once: handed to a new device with its request (usable only after
 * an approved device approves it, for 10 minutes) or by a recovery code. Stored hashed.
 */
export const EnrolToken = Base64Url.min(32).max(100);

/** The 6-digit code a new device shows, so the owner can compare it on the approving device. */
export const DeviceRequestCode = z.string().regex(/^\d{6}$/, 'Expected 6 digits');

/** Admin-issued recovery code (16 Crockford base32 characters); dashes, spaces and case are ignored. */
export const RecoveryCodeInput = z.string().trim().min(16).max(24);

/** A device name as the browser or the owner gives it ("Urmi's iPhone"). */
export const DeviceName = z.string().trim().min(1).max(80);

// ---- Sign-in -------------------------------------------------------------------------------------

/**
 * `signin`: usernameless sign-in on the owner host (no session needed).
 * `confirm`: a fingerprint for a sensitive device action (approve, remove); needs a passkey session,
 * and the options allow only that session's credential.
 */
export const PasskeyPurpose = z.enum(['signin', 'confirm']);
export type PasskeyPurpose = z.infer<typeof PasskeyPurpose>;

export const OwnerPasskeyOptionsRequest = z.object({ purpose: PasskeyPurpose });

/** A single-use challenge (5 minutes) and the options built on it. */
export const OwnerPasskeyOptions = z.object({
  challengeId: Id,
  expiresAt: EpochMs,
  options: PasskeyRequestOptions,
  /** True while an owner of the salon has no passkey yet: the sign-in page offers "Email me a code". */
  emailCode: z.boolean(),
});
export type OwnerPasskeyOptions = z.infer<typeof OwnerPasskeyOptions>;

export const OwnerPasskeyVerifyRequest = z.object({
  challengeId: Id,
  credential: PasskeyAssertion,
});

// ---- Enrolment -----------------------------------------------------------------------------------

/**
 * Without `enrolToken`: the first device, after the email code (an owner session whose owner has no
 * passkey yet). With it: a device approved through a device request, or a recovery.
 */
export const OwnerEnrolOptionsRequest = z.object({ enrolToken: EnrolToken.optional() });

export const OwnerEnrolOptions = z.object({
  challengeId: Id,
  expiresAt: EpochMs,
  options: PasskeyCreationOptions,
});
export type OwnerEnrolOptions = z.infer<typeof OwnerEnrolOptions>;

export const OwnerEnrolVerifyRequest = z.object({
  challengeId: Id,
  credential: PasskeyRegistration,
  deviceName: DeviceName,
  platform: Platform,
  enrolToken: EnrolToken.optional(),
});

/** One approved device (one passkey credential) of the signed-in owner. */
export const OwnerDeviceView = z.object({
  id: Id,
  deviceName: z.string(),
  platform: Platform,
  createdAt: EpochMs,
  lastUsedAt: EpochMs.nullable(),
  /** The passkey this session signed in with. */
  current: z.boolean(),
});
export type OwnerDeviceView = z.infer<typeof OwnerDeviceView>;

/** The new passkey and the session it started. */
export const OwnerEnrolResult = z.object({ me: Me, device: OwnerDeviceView });
export type OwnerEnrolResult = z.infer<typeof OwnerEnrolResult>;

// ---- Device requests (a new device asks, an approved device decides) ------------------------------

export const OwnerDeviceRequestStatus = z.enum(['pending', 'approved', 'declined', 'expired']);
export type OwnerDeviceRequestStatus = z.infer<typeof OwnerDeviceRequestStatus>;

export const OwnerDeviceRequestCreate = z.object({ deviceName: DeviceName, platform: Platform });

/** Shown on the new device: the code to compare and the token it keeps (never shown). */
export const OwnerDeviceRequestCreated = z.object({
  id: Id,
  code: DeviceRequestCode,
  /** The request expires 15 minutes after it is made. */
  expiresAt: EpochMs,
  enrolToken: EnrolToken,
});
export type OwnerDeviceRequestCreated = z.infer<typeof OwnerDeviceRequestCreated>;

/** The new device polls its own request with the token it was given. */
export const OwnerDeviceRequestPoll = z.object({ enrolToken: EnrolToken });

export const OwnerDeviceRequestState = z.object({
  id: Id,
  status: OwnerDeviceRequestStatus,
  expiresAt: EpochMs,
  /** After approval: the passkey must be created before this time (10 minutes). */
  enrolUntil: EpochMs.nullable(),
});
export type OwnerDeviceRequestState = z.infer<typeof OwnerDeviceRequestState>;

/** The approval card in Needs action. */
export const OwnerDeviceRequestView = z.object({
  id: Id,
  code: DeviceRequestCode,
  deviceName: z.string(),
  platform: Platform,
  /** City of the request (from the network), never more precise. */
  city: z.string().nullable(),
  status: OwnerDeviceRequestStatus,
  createdAt: EpochMs,
  expiresAt: EpochMs,
});
export type OwnerDeviceRequestView = z.infer<typeof OwnerDeviceRequestView>;

export const OwnerDeviceRequestList = z.object({ requests: z.array(OwnerDeviceRequestView) });
export type OwnerDeviceRequestList = z.infer<typeof OwnerDeviceRequestList>;

/** Approve needs a fingerprint on this device (purpose `confirm`) plus the owner PIN (step-up). */
export const OwnerDeviceRequestDecision = z.discriminatedUnion('decision', [
  z.object({
    decision: z.literal('approve'),
    challengeId: Id,
    credential: PasskeyAssertion,
  }),
  z.object({ decision: z.literal('decline') }),
]);
export type OwnerDeviceRequestDecision = z.infer<typeof OwnerDeviceRequestDecision>;

// ---- Approved devices ----------------------------------------------------------------------------

export const OwnerDeviceList = z.object({ devices: z.array(OwnerDeviceView) });
export type OwnerDeviceList = z.infer<typeof OwnerDeviceList>;

export const OwnerDeviceRenameRequest = z.object({ deviceName: DeviceName });

/** Remove needs a fingerprint on this device (purpose `confirm`) plus the owner PIN (step-up). */
export const OwnerDeviceRemoveRequest = z.object({
  challengeId: Id,
  credential: PasskeyAssertion,
});

// ---- Recovery ------------------------------------------------------------------------------------

export const OwnerRecoveryRedeemRequest = z.object({ code: RecoveryCodeInput });

/** A recovery code becomes an enrolment token for a fresh first device (10 minutes). */
export const OwnerRecoveryRedeemResult = z.object({ enrolToken: EnrolToken, expiresAt: EpochMs });
export type OwnerRecoveryRedeemResult = z.infer<typeof OwnerRecoveryRedeemResult>;
