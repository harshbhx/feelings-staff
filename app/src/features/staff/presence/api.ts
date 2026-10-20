/**
 * Presence hooks for the staff app (PRD 9.4 "Staff: presence"): the Step out button, the away card,
 * the one-time notice. None of these routes returns credits, balances or rupees. While the presence
 * API is not on the server yet (501), the query fails quietly and Today shows nothing extra.
 */
import { useQuery } from '@tanstack/react-query';
import { useApi } from '../../../api/provider';

export const presenceKey = ['staff', 'presence'] as const;

export function usePresence() {
  const api = useApi();
  return useQuery({
    queryKey: presenceKey,
    queryFn: () => api.mePresence(),
    refetchInterval: 60_000,
    retry: false,
  });
}

/** "Not now" on the notice holds until the app is opened again (4.18.1: at the next app open). */
let noticeHeld = false;
export const noticeDeferred = () => noticeHeld;
export const deferNotice = () => {
  noticeHeld = true;
};
