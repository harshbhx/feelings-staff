/** System, auth, session and profile schemas (PRD 4.1, 9.4 "System and auth"). */
import { z } from 'zod';
import { ConsentKind, DeviceStatus, Lang, Permission, Platform, Role, UserStatus } from '../enums';
import {
  Base64Url,
  Email,
  EpochMs,
  Id,
  JoinCodeInput,
  OwnerPin,
  PhoneE164,
  PhoneInput,
  Pin,
} from '../primitives';

export const Health = z.object({ ok: z.literal(true), version: z.string(), commit: z.string() });
export type Health = z.infer<typeof Health>;

export const PublicConfig = z.object({
  minAppVersion: z.string(),
  vapidPublicKey: z.string(),
  /** RSA-OAEP-256 public key (JWK) used to seal the PIN of offline punches. */
  punchEncPublicJwk: z.record(z.string(), z.unknown()),
  orgDisplayName: z.string().optional(),
  env: z.enum(['production', 'preview', 'local']),
  version: z.string(),
});
export type PublicConfig = z.infer<typeof PublicConfig>;

export const SignedTime = z.object({ serverTime: EpochMs, timeSig: z.string() });
export type SignedTime = z.infer<typeof SignedTime>;

export const SetupRequest = z.object({
  orgName: z.string().min(1).max(120),
  ownerEmail: Email,
  ownerName: z.string().min(1).max(80),
  ownerDisplayName: z.string().min(1).max(40),
});
export const SetupResult = z.object({ orgId: Id });

/** A JSON Web Key for an ECDSA P-256 public key. */
export const EcPublicJwk = z.object({
  kty: z.literal('EC'),
  crv: z.literal('P-256'),
  x: Base64Url,
  y: Base64Url,
  ext: z.boolean().optional(),
  key_ops: z.array(z.string()).optional(),
});
export type EcPublicJwk = z.infer<typeof EcPublicJwk>;

export const JoinLookupQuery = z.object({ code: JoinCodeInput });
export const JoinLookup = z.object({
  status: z.enum(['valid', 'expired', 'used', 'unknown']),
  staffFirstName: z.string().nullable(),
  orgName: z.string().nullable(),
  ownerDisplayName: z.string().nullable(),
  ownerPhone: PhoneE164.nullable(),
});
export type JoinLookup = z.infer<typeof JoinLookup>;

export const JoinVerifyRequest = z.object({ phone: PhoneInput, code: JoinCodeInput });
export const JoinVerifyResult = z.object({
  staffFirstName: z.string(),
  orgName: z.string(),
  ownerDisplayName: z.string(),
  lang: Lang,
  /** Consents the person must give before finishing (privacy notice always; selfie if required). */
  consentsRequired: z.array(ConsentKind),
  privacyNoticeVersion: z.string(),
});
export type JoinVerifyResult = z.infer<typeof JoinVerifyResult>;

export const ConsentGiven = z.object({
  kind: ConsentKind,
  version: z.string(),
  lang: Lang,
});
export type ConsentGiven = z.infer<typeof ConsentGiven>;

export const JoinCompleteRequest = z.object({
  phone: PhoneInput,
  code: JoinCodeInput,
  pin: Pin,
  deviceJwk: EcPublicJwk,
  deviceLabel: z.string().min(1).max(80),
  platform: Platform,
  consents: z.array(ConsentGiven).min(1),
  /** navigator.storage.persist() result, for the "keep this app installed" tip. */
  storagePersisted: z.boolean(),
});
export type JoinCompleteRequest = z.infer<typeof JoinCompleteRequest>;

export const ChallengeQuery = z.object({ purpose: z.literal('login') });
export const Challenge = z.object({ nonce: Base64Url, expiresAt: EpochMs });
export type Challenge = z.infer<typeof Challenge>;

export const StaffLoginRequest = z.object({
  phone: PhoneInput,
  pin: Pin,
  deviceId: Id,
  nonce: Base64Url,
  /** ECDSA P-256/SHA-256 signature (base64url, IEEE P1363) over the nonce bytes. */
  signature: Base64Url,
});
export type StaffLoginRequest = z.infer<typeof StaffLoginRequest>;

export const NewDeviceRequest = z.object({
  phone: PhoneInput,
  pin: Pin,
  deviceJwk: EcPublicJwk,
  deviceLabel: z.string().min(1).max(80),
  platform: Platform,
});
export const NewDeviceResult = z.object({ status: z.literal('pending'), deviceId: Id });

export const OwnerMagicRequest = z.object({ email: Email });
export const OwnerVerifyRequest = z.union([
  z.object({ token: z.string().min(16).max(200) }),
  z.object({ email: Email, code: z.string().regex(/^\d{6}$/) }),
]);
export type OwnerVerifyRequest = z.infer<typeof OwnerVerifyRequest>;
export const OwnerPasswordRequest = z.object({
  email: Email,
  password: z.string().min(10).max(200),
  pin: OwnerPin,
});

export const StepUpRequest = z.object({ pin: OwnerPin });
export const StepUpResult = z.object({ stepUpUntil: EpochMs });

export const MeUser = z.object({
  id: Id,
  name: z.string(),
  role: Role,
  status: UserStatus,
  phone: PhoneE164.nullable(),
  email: z.string().nullable(),
  lang: Lang,
  designation: z.string().nullable(),
  joinDate: z.string().nullable(),
});

export const MeOrg = z.object({
  id: Id,
  name: z.string(),
  ownerDisplayName: z.string(),
  /** For "Call Urmi" / WhatsApp links. */
  contactPhone: PhoneE164.nullable(),
  timezone: z.literal('Asia/Kolkata'),
});

export const MeDevice = z.object({
  id: Id,
  label: z.string(),
  status: DeviceStatus,
  approvedAt: EpochMs.nullable(),
});

export const MeFlags = z.object({
  selfieRequired: z.boolean(),
  selfieOnCheckOut: z.boolean(),
  strongMode: z.boolean(),
  breakPunches: z.boolean(),
  pinEveryPunch: z.boolean(),
  showPayslips: z.boolean(),
  /** Consents still to give (e.g. a new privacy notice version, night work). */
  consentsNeeded: z.array(ConsentKind),
  /** Owner only: has a password and an owner PIN been set up. */
  ownerPinSet: z.boolean(),
  ownerPasswordSet: z.boolean(),
  /** Owner only: setup checklist not finished. */
  setupIncomplete: z.boolean(),
  /** Step-up valid until (owner/manager), else null. */
  stepUpUntil: EpochMs.nullable(),
  /** Staff only: tip shown when storage persistence was refused at join. */
  storageTip: z.boolean(),
});

export const Me = z.object({
  user: MeUser,
  org: MeOrg,
  device: MeDevice.nullable(),
  permissions: z.array(Permission),
  flags: MeFlags,
});
export type Me = z.infer<typeof Me>;

export const MePatch = z.object({
  lang: Lang.optional(),
  name: z.string().min(1).max(80).optional(),
});

export const ConsentWithdrawParams = z.object({ kind: ConsentKind });
