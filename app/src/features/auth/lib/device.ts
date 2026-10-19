/**
 * Device key orchestration for join, new phone and sign-in (PRD 4.1.4, 4.1.6), on top of WP-3's
 * `lib/device-key.ts`. Dependencies are injectable so the retry and rollback rules are unit-tested.
 *
 * - Join reuses this phone's key when it is already approved (a PIN reset on the same phone keeps
 *   the phone approved); otherwise, and for "I have a new phone", a fresh key is made.
 * - `CONFLICT { reason: 'device_key_used' }` means the server has seen that key for someone else:
 *   make a fresh key and try once more.
 * - If enrolment fails after a fresh key was made, the previous record is put back, so a mistyped
 *   PIN never costs an approved phone its key.
 * - Sign-in signs a fresh challenge; `NONCE_INVALID` (expired or used) fetches a new one once.
 */
import { type ApiClient, type EcPublicJwk, isApiError, type Me } from '@fs/contracts';
import {
  clearDeviceKey,
  createDeviceKey,
  DeviceKeyError,
  getDeviceRecord,
  sign,
} from '../../../lib/device-key';
import { type DeviceRecord, openFeelingsDb } from '../../../lib/idb';

export interface KeyStore {
  getDeviceRecord(): Promise<DeviceRecord | null>;
  createDeviceKey(): Promise<DeviceRecord>;
  /** Put a record back (or clear the store when null). */
  restore(previous: DeviceRecord | null): Promise<void>;
  sign(message: string): Promise<string>;
}

async function restoreRecord(previous: DeviceRecord | null): Promise<void> {
  if (!previous) {
    await clearDeviceKey();
    return;
  }
  try {
    const db = await openFeelingsDb();
    await db.put('device', previous, 'current');
  } catch {
    // storage gone: nothing to restore into
  }
}

export const browserKeyStore: KeyStore = {
  getDeviceRecord,
  createDeviceKey: () => createDeviceKey(),
  restore: restoreRecord,
  sign,
};

/** The contract's EC public JWK from the stored record. */
export function toEcJwk(jwk: JsonWebKey): EcPublicJwk {
  return { kty: 'EC', crv: 'P-256', x: jwk.x ?? '', y: jwk.y ?? '' };
}

function keyAlreadyUsed(e: unknown): boolean {
  return isApiError(e, 'CONFLICT') && e.details?.reason === 'device_key_used';
}

/**
 * Register this phone's key with `send` (join/complete or new-device). Returns the server's answer
 * and the record that was sent.
 */
export async function enrolDevice<T>(
  send: (jwk: EcPublicJwk) => Promise<T>,
  opts: { reuseApproved: boolean },
  keys: KeyStore = browserKeyStore,
): Promise<{ result: T; record: DeviceRecord; reused: boolean }> {
  const previous = await keys.getDeviceRecord();
  const reuse = Boolean(opts.reuseApproved && previous?.deviceId && previous.approved);
  let record = reuse && previous ? previous : await keys.createDeviceKey();
  let fresh = !reuse;
  try {
    try {
      return { result: await send(toEcJwk(record.publicJwk)), record, reused: !fresh };
    } catch (e) {
      if (!keyAlreadyUsed(e)) throw e;
      record = await keys.createDeviceKey();
      fresh = true;
      return { result: await send(toEcJwk(record.publicJwk)), record, reused: false };
    }
  } catch (e) {
    if (fresh) await keys.restore(previous);
    throw e;
  }
}

export interface StaffCredentials {
  /** E.164 phone. */
  phone: string;
  pin: string;
}

/** Challenge, sign with this phone's key, sign in (PRD 4.1.6). Throws DeviceKeyError('missing'). */
export async function staffSignIn(
  api: Pick<ApiClient, 'authChallenge' | 'staffLogin'>,
  creds: StaffCredentials,
  keys: Pick<KeyStore, 'getDeviceRecord' | 'sign'> = browserKeyStore,
): Promise<Me> {
  const record = await keys.getDeviceRecord();
  if (!record?.deviceId) throw new DeviceKeyError('missing');
  const deviceId = record.deviceId;
  for (let attempt = 0; ; attempt++) {
    const { nonce } = await api.authChallenge({ query: { purpose: 'login' } });
    const signature = await keys.sign(nonce);
    try {
      return await api.staffLogin({
        body: { phone: creds.phone, pin: creds.pin, deviceId, nonce, signature },
      });
    } catch (e) {
      if (attempt === 0 && isApiError(e, 'NONCE_INVALID')) continue;
      throw e;
    }
  }
}
