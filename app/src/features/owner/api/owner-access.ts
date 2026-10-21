/**
 * Owner access queries (docs/owner-access.md, ADR-19): device requests for the approval cards in Needs
 * action. These routes exist only on the owner host, so the queries run only in the owner build
 * (`OWNER_ONLY`); everywhere else they stay idle and the screens show nothing extra.
 */
import type { OwnerDeviceRequestView } from '@fs/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../../api/provider';
import { OWNER_ONLY } from '../../../lib/surface';
import { useStepUp } from '../../auth/step-up';
import type { ConfirmWithPasskey } from '../lib/passkey-confirm';
import { ownerQuery } from './query';

export const ownerAccessKeys = {
  all: ['owner', 'access'] as const,
  deviceRequests: () => ['owner', 'access', 'device-requests'] as const,
};

/** A new device can ask while Needs action is open: look again now and then. */
const REQUESTS_REFRESH_MS = 10_000;

/** Pending device requests (newest first); always empty outside the owner build. */
export function useDeviceRequests() {
  const api = useApi();
  return useQuery({
    ...ownerQuery('ownerDeviceRequestList', ownerAccessKeys.deviceRequests(), () =>
      api.ownerDeviceRequestList(),
    ),
    enabled: OWNER_ONLY,
    refetchInterval: REQUESTS_REFRESH_MS,
  });
}

export type DeviceDecision = 'approve' | 'decline';

/**
 * Approve: the fingerprint on this device first, then the owner PIN if the server asks for it (the
 * same answer is sent again after the PIN). Decline: the PIN only.
 */
export function useDecideDeviceRequest(confirm: ConfirmWithPasskey) {
  const api = useApi();
  const qc = useQueryClient();
  const { run } = useStepUp();
  return useMutation<OwnerDeviceRequestView, Error, { id: string; decision: DeviceDecision }>({
    mutationFn: async ({ id, decision }) => {
      if (decision === 'decline')
        return run(() =>
          api.ownerDeviceRequestDecide({ params: { id }, body: { decision: 'decline' } }),
        );
      const answer = await confirm();
      return run(() =>
        api.ownerDeviceRequestDecide({ params: { id }, body: { decision: 'approve', ...answer } }),
      );
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ownerAccessKeys.deviceRequests() }),
  });
}
