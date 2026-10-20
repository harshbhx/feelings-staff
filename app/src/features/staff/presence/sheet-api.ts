/**
 * Presence hooks that only the lazy sheets and the history screen use, kept out of the staff
 * shell chunk (PRD 11.10 JS budget).
 */
import type { AwayIntervalStaff, AwayReason, PresenceState } from '@fs/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../../api/provider';
import { presenceKey } from './api';
import { PRESENCE_NOTICE_VERSION } from './presence-model';

/** My data -> Presence for one month (`YYYY-MM`): marks, step-outs with state, checks. */
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

export const newPresenceKey = () => crypto.randomUUID();

export function usePresenceHistory(month: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...presenceKey, 'history', month] as const,
    queryFn: () => api.mePresenceHistory({ query: { month } }),
  });
}

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

export function useAwayNote() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; note: string }) =>
      api.mePresenceAwayNote({ params: { id: v.id }, body: { note: v.note } }),
    // A note does not end the interval: only the note changes on the open card.
    onSuccess: (away) =>
      qc.setQueryData<PresenceState>(presenceKey, (prev) =>
        prev?.openAway?.id === away.id
          ? { ...prev, openAway: { ...prev.openAway, staffNote: away.staffNote } }
          : prev,
      ),
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
