/**
 * The fingerprint that approving a device and removing one need (docs/owner-access.md "Passkeys",
 * flows 3 and 4): a `confirm` challenge for this session, answered by this device's passkey. The
 * challenge is fetched before the tap, because Safari opens the passkey sheet only right after one.
 * Owner build only (it pulls in the WebAuthn helpers).
 */
import type { OwnerPasskeyOptions, PasskeyAssertion } from '@fs/contracts';
import { useCallback, useEffect, useRef } from 'react';
import { useApi } from '../../../api/provider';
import { getPasskey } from '../../auth/lib/passkey';

/** Fetch a fresh challenge this long before the old one runs out. */
const MARGIN_MS = 15_000;

export interface PasskeyAnswer {
  challengeId: string;
  credential: PasskeyAssertion;
}

export type ConfirmWithPasskey = () => Promise<PasskeyAnswer>;

/**
 * `confirm()` opens the passkey sheet and resolves with the answer to send. A closed sheet rejects
 * with the browser's error (`passkeyProblem` says "cancelled") and keeps the challenge for the next
 * tap; a used one is replaced in the background.
 */
export function usePasskeyConfirm(enabled: boolean): ConfirmWithPasskey {
  const api = useApi();
  const ready = useRef<OwnerPasskeyOptions | null>(null);
  const fetching = useRef<Promise<OwnerPasskeyOptions> | null>(null);

  const prefetch = useCallback((): Promise<OwnerPasskeyOptions> => {
    if (!fetching.current) {
      fetching.current = api
        .ownerPasskeyOptions({ body: { purpose: 'confirm' } })
        .then((o) => {
          ready.current = o;
          return o;
        })
        .finally(() => {
          fetching.current = null;
        });
    }
    return fetching.current;
  }, [api]);

  useEffect(() => {
    if (enabled && !ready.current) prefetch().catch(() => undefined);
  }, [enabled, prefetch]);

  return useCallback(async () => {
    let options = ready.current;
    if (!options || options.expiresAt - MARGIN_MS < Date.now()) options = await prefetch();
    ready.current = null;
    let credential: PasskeyAssertion;
    try {
      credential = await getPasskey(options.options);
    } catch (e) {
      // Nothing reached the server: the same challenge still works for the next tap.
      ready.current = options;
      throw e;
    }
    // This challenge is about to be used up; have the next one ready.
    prefetch().catch(() => undefined);
    return { challengeId: options.challengeId, credential };
  }, [prefetch]);
}
