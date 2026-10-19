/**
 * Presence hooks for the staff app (PRD 9.4 "Staff: presence"): the Step out button, the away card,
 * the one-time notice. None of these routes returns credits, balances or rupees. While the presence
 * API is not on the server yet (501), the query fails quietly and Today shows nothing extra.
 */
import type { AwayIntervalStaff, AwayReason, PresenceState } from '@fs/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../../api/provider';
import { PRESENCE_NOTICE_VERSION } from './presence-model';

export const presenceKey = ['staff', 'presence'] as const;

export function usePresence() {
  const api = useApi();
  return useQuery({
    queryKey: presenceKey,
    queryFn: () => api.mePresence(),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    retry: false,
  });
}

/** Keep the open interval on Today straight from the server's answer. */
function useSetOpenAway() {
  const qc = useQueryClient();
  return (away: AwayIntervalStaff | null) =>
    qc.setQueryData<PresenceState>(presenceKey, (prev) => {
      if (!prev) return prev;
      const { openAway: _old, ...rest } = prev;
      return away && away.endTs === null ? { ...rest, openAway: away } : rest;
    });
}

const newKey = () => crypto.randomUUID();

export function useStepOut() {
  const api = useApi();
  const setOpen = useSetOpenAway();
  return useMutation({
    mutationFn: (v: { reason: AwayReason; note: string; key: string }) =>
      api.presenceStepOut(
        {
          body: {
            reason: v.reason,
            ...(v.note ? { note: v.note } : {}),
            idempotencyKey: v.key,
          },
        },
        { idempotencyKey: v.key },
      ),
    onSuccess: (away) => setOpen(away),
  });
}

export function useBack() {
  const api = useApi();
  const setOpen = useSetOpenAway();
  return useMutation({
    mutationFn: (key: string) =>
      api.presenceBack({ body: { idempotencyKey: key } }, { idempotencyKey: key }),
    onSuccess: () => setOpen(null),
  });
}

export function useAwayNote() {
  const api = useApi();
  const setOpen = useSetOpenAway();
  return useMutation({
    mutationFn: (v: { id: string; note: string }) =>
      api.mePresenceAwayNote({ params: { id: v.id }, body: { note: v.note } }),
    onSuccess: (away) => setOpen(away),
  });
}

/** The one-time presence notice (4.18.1): a `presence_checks` consent row. */
export function usePresenceConsent() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (lang: 'en' | 'gu') =>
      api.consentGive({
        body: { kind: 'presence_checks', version: PRESENCE_NOTICE_VERSION, lang },
      }),
    onSuccess: () =>
      qc.setQueryData<PresenceState>(presenceKey, (prev) =>
        prev ? { ...prev, consentNeeded: false } : prev,
      ),
  });
}

export { newKey as newPresenceKey };

const NOT_NOW = 'fs.presence.notNow';

/** "Not now" on the notice holds until the app is opened again (4.18.1: at the next app open). */
export function noticeDeferred(): boolean {
  try {
    return sessionStorage.getItem(NOT_NOW) === '1';
  } catch {
    return false;
  }
}

export function deferNotice(): void {
  try {
    sessionStorage.setItem(NOT_NOW, '1');
  } catch {
    // Private mode: the notice may show again on the next screen; that is fine.
  }
}
