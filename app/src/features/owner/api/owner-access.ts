/**
 * Owner access queries (docs/owner-access.md, ADR-19): device requests for the approval cards in Needs
 * action, and the approved devices in Settings, Security (rename, remove). These routes exist only on
 * the owner host, so the queries run only in the owner build (`OWNER_ONLY`); everywhere else they stay
 * idle and the screens show nothing extra.
 */
import type { OwnerDeviceList, OwnerDeviceRequestView, OwnerDeviceView } from '@fs/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../../api/provider';
import { OWNER_ONLY } from '../../../lib/surface';
import { useStepUp } from '../../auth/step-up';
import type { ConfirmWithPasskey } from '../lib/passkey-confirm';
import { ownerQuery } from './query';

export const ownerAccessKeys = {
  all: ['owner', 'access'] as const,
  deviceRequests: () => ['owner', 'access', 'device-requests'] as const,
  devices: () => ['owner', 'access', 'devices'] as const,
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

/** The approved devices (passkeys) of the signed-in owner, oldest first. */
export function useOwnerDevices() {
  const api = useApi();
  return useQuery({
    ...ownerQuery('ownerDeviceList', ownerAccessKeys.devices(), () => api.ownerDeviceList()),
    enabled: OWNER_ONLY,
  });
}

export function useRenameDevice() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation<OwnerDeviceView, Error, { id: string; deviceName: string }>({
    mutationFn: ({ id, deviceName }) =>
      api.ownerDeviceRename({ params: { id }, body: { deviceName } }),
    onSuccess: (device) =>
      qc.setQueryData<OwnerDeviceList>(ownerAccessKeys.devices(), (old) =>
        old ? { devices: old.devices.map((d) => (d.id === device.id ? device : d)) } : old,
      ),
  });
}

/** Remove: the fingerprint on this device first, then the owner PIN if the server asks for it. */
export function useRemoveDevice(confirm: ConfirmWithPasskey) {
  const api = useApi();
  const qc = useQueryClient();
  const { run } = useStepUp();
  return useMutation<OwnerDeviceList, Error, { id: string }>({
    mutationFn: async ({ id }) => {
      const answer = await confirm();
      return run(() => api.ownerDeviceRemove({ params: { id }, body: answer }));
    },
    onSuccess: (list) => qc.setQueryData(ownerAccessKeys.devices(), list),
  });
}
