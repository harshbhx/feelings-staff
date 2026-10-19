/**
 * Settings, setup checklist, security, audit log, holidays and blackout days, templates, sites and
 * calibration, door devices, managers (PRD 4.5, 4.15, 4.17, 10.7; endpoints by WP-1, WP-3, WP-4).
 */
import type {
  CalibrationSamples,
  SettingsPatchRequest,
  SettingsView,
  SetupStep,
  SitePatch,
} from '@fs/contracts';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import { meQueryKey } from '../../../api/hooks';
import { useApi } from '../../../api/provider';
import { type AuditFilter, ownerKeys } from './keys';
import { held, retryUnlessHeld } from './mock-states';
import { ownerQuery, useOwnerMutation } from './query';

export function useSettings() {
  const api = useApi();
  return useQuery(
    ownerQuery('ownerSettingsGet', ownerKeys.settings(), () => api.ownerSettingsGet()),
  );
}

/** Patch settings; strong mode and risk thresholds ask for the PIN (server decides). */
export function usePatchSettings() {
  const qc = useQueryClient();
  return useOwnerMutation({
    run: (api, body: z.input<typeof SettingsPatchRequest>, call) =>
      api.ownerSettingsPatch({ body }, call),
    onSuccess: (view: SettingsView) => qc.setQueryData(ownerKeys.settings(), view),
    invalidate: () => [meQueryKey, ownerKeys.setup()],
  });
}

export function useSetup() {
  const api = useApi();
  return useQuery(ownerQuery('ownerSetupGet', ownerKeys.setup(), () => api.ownerSetupGet()));
}

export function useSetupStep() {
  const qc = useQueryClient();
  return useOwnerMutation({
    run: (api, v: { step: SetupStep; state: 'done' | 'skipped' | 'todo' }, call) =>
      api.ownerSetupStep({ params: { step: v.step }, body: { state: v.state } }, call),
    onSuccess: (view) => qc.setQueryData(ownerKeys.setup(), view),
    invalidate: () => [meQueryKey],
  });
}

export function useSecurity() {
  const api = useApi();
  return useQuery(
    ownerQuery('ownerSecurityGet', ownerKeys.security(), () => api.ownerSecurityGet()),
  );
}

export function useSetPassword() {
  const qc = useQueryClient();
  return useOwnerMutation({
    run: (api, body: { password: string; pin: string }, call) =>
      api.ownerSetPassword({ body }, call),
    onSuccess: (view) => qc.setQueryData(ownerKeys.security(), view),
    invalidate: () => [meQueryKey],
  });
}

export function useSetPin() {
  const qc = useQueryClient();
  return useOwnerMutation({
    run: (api, v: { pin: string; currentPin?: string }, call) =>
      api.ownerSetPin(
        { body: v.currentPin ? { pin: v.pin, currentPin: v.currentPin } : { pin: v.pin } },
        call,
      ),
    onSuccess: (view) => qc.setQueryData(ownerKeys.security(), view),
    invalidate: () => [meQueryKey],
  });
}

export function useSignOutOthers() {
  const qc = useQueryClient();
  return useOwnerMutation({
    run: (api, _v: undefined, call) => api.ownerSignOutOthers(undefined, call),
    onSuccess: (view) => qc.setQueryData(ownerKeys.security(), view),
  });
}

/** Audit log, newest first, one page at a time (PRD 10.7, O-18). */
export function useAudit(filter: AuditFilter) {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: ownerKeys.audit(filter),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      held('ownerAudit', () =>
        api.ownerAudit({
          query: {
            ...(filter.entity ? { entity: filter.entity } : {}),
            ...(filter.category ? { category: filter.category } : {}),
            ...(filter.from ? { from: filter.from } : {}),
            ...(filter.to ? { to: filter.to } : {}),
            ...(pageParam ? { cursor: pageParam } : {}),
          },
        }),
      ),
    getNextPageParam: (last) => last.nextCursor,
    retry: retryUnlessHeld('ownerAudit'),
  });
}

// ---- Calendar: templates, holidays, blackout days ------------------------------------------

export function useBlackouts(year: number) {
  const api = useApi();
  return useQuery(
    ownerQuery('ownerBlackoutList', ownerKeys.blackouts(year), () =>
      api.ownerBlackoutList({ query: { year } }),
    ),
  );
}

// ---- Sites, calibration, door devices -------------------------------------------------------

export function usePatchSite() {
  return useOwnerMutation({
    run: (api, v: { id: string; patch: z.input<typeof SitePatch> }, call) =>
      api.ownerSitePatch({ params: { id: v.id }, body: v.patch }, call),
    invalidate: () => [ownerKeys.sites(), ownerKeys.setup()],
  });
}

export function useStoreCalibration(siteId: string) {
  return useOwnerMutation({
    run: (api, body: z.input<typeof CalibrationSamples>, call) =>
      api.ownerCalibrationSamples({ params: { id: siteId }, body }, call),
    invalidate: () => [ownerKeys.calibration(siteId)],
  });
}

export function useCalibrationProposal(siteId: string, enabled = true) {
  const api = useApi();
  return useQuery({
    ...ownerQuery('ownerCalibrationPropose', ownerKeys.calibration(siteId), () =>
      api.ownerCalibrationPropose({ params: { id: siteId } }),
    ),
    enabled,
  });
}

export function useDoorDevices() {
  const api = useApi();
  return useQuery(
    ownerQuery('ownerDoorDevicesList', ownerKeys.doorDevices(), () => api.ownerDoorDevicesList()),
  );
}

export function useManagers() {
  const api = useApi();
  return useQuery(
    ownerQuery('ownerManagersList', ownerKeys.managers(), () => api.ownerManagersList()),
  );
}
