/**
 * Passkeys in the browser, owner host only (docs/owner-access.md, ADR-19): the API's JSON options to
 * `navigator.credentials`, and the browser's answer back to JSON. A few lines of our own instead of
 * @simplewebauthn/browser. Only the owner build imports this module.
 */
import {
  fromBase64Url,
  type PasskeyAssertion,
  type PasskeyCreationOptions,
  type PasskeyDescriptor,
  type PasskeyRegistration,
  type PasskeyRequestOptions,
  type Platform,
  toBase64Url,
} from '@fs/contracts';

/** True when this browser can create and use a passkey at all. */
export function passkeysSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential === 'function' &&
    typeof navigator.credentials?.create === 'function'
  );
}

/** What went wrong in the browser, in the words the screens need. */
export type PasskeyProblem = 'cancelled' | 'exists' | 'unsupported' | 'failed';

/**
 * `NotAllowedError` is what browsers give for a closed or timed-out sheet (and they do not say which):
 * treat it as "nothing happened". `InvalidStateError` on create means this authenticator already holds
 * a passkey for the account.
 */
export function passkeyProblem(e: unknown): PasskeyProblem {
  const name = e instanceof Error || e instanceof DOMException ? e.name : '';
  if (name === 'NotAllowedError' || name === 'AbortError') return 'cancelled';
  if (name === 'InvalidStateError') return 'exists';
  if (name === 'NotSupportedError' || name === 'SecurityError') return 'unsupported';
  return 'failed';
}

/** The platform for the device list, from the user agent (a label, not a security signal). */
export function platformOf(ua: string = navigator.userAgent): Platform {
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  if (/Windows|Macintosh|Mac OS X|Linux|CrOS/i.test(ua)) return 'desktop';
  return 'other';
}

function descriptor(d: PasskeyDescriptor): PublicKeyCredentialDescriptor {
  return {
    type: 'public-key',
    id: fromBase64Url(d.id),
    ...(d.transports ? { transports: d.transports as AuthenticatorTransport[] } : {}),
  };
}

function attachmentOf(c: PublicKeyCredential): 'platform' | 'cross-platform' | null {
  const a = c.authenticatorAttachment;
  return a === 'platform' || a === 'cross-platform' ? a : null;
}

/** `navigator.credentials.create()` with the server's options; the answer as `PasskeyRegistration`. */
export async function createPasskey(
  o: PasskeyCreationOptions,
  signal?: AbortSignal,
): Promise<PasskeyRegistration> {
  const sel = o.authenticatorSelection;
  const publicKey: PublicKeyCredentialCreationOptions = {
    rp: o.rp.id ? { id: o.rp.id, name: o.rp.name } : { name: o.rp.name },
    user: { id: fromBase64Url(o.user.id), name: o.user.name, displayName: o.user.displayName },
    challenge: fromBase64Url(o.challenge),
    pubKeyCredParams: o.pubKeyCredParams.map((p) => ({ type: 'public-key' as const, alg: p.alg })),
    excludeCredentials: (o.excludeCredentials ?? []).map(descriptor),
    attestation: o.attestation ?? 'none',
    ...(o.timeout ? { timeout: o.timeout } : {}),
    ...(sel
      ? {
          authenticatorSelection: {
            ...(sel.authenticatorAttachment
              ? { authenticatorAttachment: sel.authenticatorAttachment }
              : {}),
            ...(sel.residentKey ? { residentKey: sel.residentKey } : {}),
            ...(sel.requireResidentKey !== undefined
              ? { requireResidentKey: sel.requireResidentKey }
              : {}),
            ...(sel.userVerification ? { userVerification: sel.userVerification } : {}),
          },
        }
      : {}),
  };
  const cred = (await navigator.credentials.create({
    publicKey,
    ...(signal ? { signal } : {}),
  })) as PublicKeyCredential | null;
  if (!cred) throw new DOMException('No passkey was made.', 'NotAllowedError');
  const r = cred.response as AuthenticatorAttestationResponse;
  const transports = typeof r.getTransports === 'function' ? r.getTransports() : [];
  return {
    id: cred.id,
    rawId: toBase64Url(cred.rawId),
    type: 'public-key',
    authenticatorAttachment: attachmentOf(cred),
    clientExtensionResults: {},
    response: {
      clientDataJSON: toBase64Url(r.clientDataJSON),
      attestationObject: toBase64Url(r.attestationObject),
      transports,
    },
  };
}

/** `navigator.credentials.get()` with the server's options; the answer as `PasskeyAssertion`. */
export async function getPasskey(
  o: PasskeyRequestOptions,
  signal?: AbortSignal,
): Promise<PasskeyAssertion> {
  const publicKey: PublicKeyCredentialRequestOptions = {
    challenge: fromBase64Url(o.challenge),
    allowCredentials: (o.allowCredentials ?? []).map(descriptor),
    userVerification: o.userVerification ?? 'required',
    ...(o.timeout ? { timeout: o.timeout } : {}),
    ...(o.rpId ? { rpId: o.rpId } : {}),
  };
  const cred = (await navigator.credentials.get({
    publicKey,
    ...(signal ? { signal } : {}),
  })) as PublicKeyCredential | null;
  if (!cred) throw new DOMException('No passkey was used.', 'NotAllowedError');
  const r = cred.response as AuthenticatorAssertionResponse;
  return {
    id: cred.id,
    rawId: toBase64Url(cred.rawId),
    type: 'public-key',
    authenticatorAttachment: attachmentOf(cred),
    clientExtensionResults: {},
    response: {
      clientDataJSON: toBase64Url(r.clientDataJSON),
      authenticatorData: toBase64Url(r.authenticatorData),
      signature: toBase64Url(r.signature),
      userHandle: r.userHandle ? toBase64Url(r.userHandle) : null,
    },
  };
}
