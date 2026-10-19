/**
 * Roster, shift templates, holidays, sites, calibration, off-site duties and the door code
 * (PRD 4.5, 4.6, 4.15, 5.2; endpoints by WP-4).
 */
import type { DutyCreate, RosterChange } from '@fs/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../../api/provider';
import { ownerKeys } from './keys';
import { ownerQuery, useOwnerMutation } from './query';

export function useRoster(week: string) {
  const api = useApi();
  return useQuery({
    ...ownerQuery('ownerRosterGet', ownerKeys.roster(week), () =>
      api.ownerRosterGet({ query: { week } }),
    ),
    placeholderData: (prev) => prev,
  });
}

export function useRosterChange(week: string) {
  const qc = useQueryClient();
  return useOwnerMutation({
    run: (api, changes: RosterChange[], call) => api.ownerRosterPut({ body: { changes } }, call),
    onSuccess: (view) => qc.setQueryData(ownerKeys.roster(week), view),
    invalidate: () => [ownerKeys.today(), ownerKeys.registerAll()],
  });
}

export function useShiftTemplates() {
  const api = useApi();
  return useQuery({
    ...ownerQuery('ownerShiftTemplatesList', ownerKeys.templates(), () =>
      api.ownerShiftTemplatesList(),
    ),
    staleTime: 5 * 60_000,
  });
}

export function useHolidays(year: number) {
  const api = useApi();
  return useQuery(
    ownerQuery('ownerHolidaysList', ownerKeys.holidays(year), () =>
      api.ownerHolidaysList({ query: { year } }),
    ),
  );
}

export function useSites() {
  const api = useApi();
  return useQuery({
    ...ownerQuery('ownerSites', ownerKeys.sites(), () => api.ownerSites()),
    staleTime: 5 * 60_000,
  });
}

export function useDuties(from: string, to: string) {
  const api = useApi();
  return useQuery(
    ownerQuery('ownerDutiesList', ownerKeys.duties(from, to), () =>
      api.ownerDutiesList({ query: { from, to } }),
    ),
  );
}

export function useDuty(id: string | null) {
  const api = useApi();
  return useQuery({
    ...ownerQuery('ownerDutyGet', ownerKeys.duty(id ?? ''), () =>
      api.ownerDutyGet({ params: { id: id ?? '' } }),
    ),
    enabled: id !== null,
  });
}

const afterDuty = () => [
  ownerKeys.dutiesAll(),
  ownerKeys.rosterAll(),
  ownerKeys.today(),
  ownerKeys.sites(),
];

export function useCreateDuty() {
  return useOwnerMutation({
    run: (api, body: DutyCreate, call) => api.ownerDutyCreate({ body }, call),
    invalidate: afterDuty,
  });
}

export function usePatchDuty(id: string) {
  return useOwnerMutation({
    run: (api, body: Partial<DutyCreate>, call) =>
      api.ownerDutyPatch({ params: { id }, body }, call),
    invalidate: () => [...afterDuty(), ownerKeys.duty(id)],
  });
}

export function useCancelDuty() {
  return useOwnerMutation({
    run: (api, id: string, call) => api.ownerDutyCancel({ params: { id } }, call),
    invalidate: afterDuty,
  });
}

/** Read a location from a pasted Google Maps link (server expands short links, PRD 4.6). */
export function useResolveMapsLink() {
  return useOwnerMutation({
    run: (api, url: string, call) => api.ownerMapsResolve({ body: { url } }, call),
  });
}

/** The current door token for the salon; refreshed every 30 s while shown (PRD 4.5). */
export const DOOR_CODE_REFRESH_MS = 30_000;

export function useDoorCode(enabled = true) {
  const api = useApi();
  return useQuery({
    ...ownerQuery('ownerDoorCode', ownerKeys.doorCode(), () => api.ownerDoorCode()),
    enabled,
    // Fetch the next token as soon as the current one expires. If this phone's clock disagrees
    // with the server's, fall back to a plain 30 s refresh.
    refetchInterval: (query) => {
      const code = query.state.data;
      const left = code ? code.expiresAt - Date.now() : -1;
      return left >= 1_000 && left <= DOOR_CODE_REFRESH_MS ? left + 250 : DOOR_CODE_REFRESH_MS;
    },
    refetchIntervalInBackground: false,
    staleTime: 0,
    gcTime: 0,
  });
}
