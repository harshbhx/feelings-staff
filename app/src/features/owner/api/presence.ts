/**
 * Query and mutation hooks for presence (PRD 4.18, 9.4 "Owner: Time credits and presence"): the
 * day's roll-call slots, one roll-call, Done (submit or edit), and away interval edits. The owner
 * and managers with `rollcall` use these; none of them carries credits.
 */
import type { AwayIntervalView, AwayPatch, Me, RollCallResult } from '@fs/contracts';
import { useQuery } from '@tanstack/react-query';
import { useMe } from '../../../api/hooks';
import { useApi } from '../../../api/provider';
import { ownerKeys } from './keys';
import { newIntentKey, ownerQuery, useOwnerMutation } from './query';

/** Owner, or a manager with the `rollcall` permission (PRD 10.2). */
export function canRollCall(me: Me | null | undefined): boolean {
  if (!me) return false;
  return me.user.role === 'owner' || me.permissions.includes('rollcall');
}

export function useCanRollCall(): boolean {
  return canRollCall(useMe().data);
}

export function useIsOwner(): boolean {
  return useMe().data?.user.role === 'owner';
}

/** Today's roll-call slots with their status (upcoming, open, done, missed). */
export function useRollCallDay(enabled = true) {
  const api = useApi();
  return useQuery({
    ...ownerQuery('ownerRollCalls', ownerKeys.rollCalls(), () => api.ownerRollCalls({ query: {} })),
    enabled,
  });
}

export function useRollCall(id: string) {
  const api = useApi();
  return useQuery({
    ...ownerQuery('ownerRollCallGet', ownerKeys.rollCall(id), () =>
      api.ownerRollCallGet({ params: { id } }),
    ),
    // Marks being chosen must not be reset by a background refetch.
    refetchOnWindowFocus: false,
  });
}

/** Open away intervals for Today's "Away now" (owner only: managers get 403 here). */
export function useAwayNow(enabled: boolean) {
  const api = useApi();
  return useQuery({
    ...ownerQuery('ownerAwayList', ownerKeys.awayOpen(), () =>
      api.ownerAwayList({ query: { state: 'open' } }),
    ),
    enabled,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    select: (list: AwayIntervalView[]) =>
      list.filter((a) => a.state === 'open' && a.endTs === null),
  });
}

const afterPresence = () => [
  ownerKeys.today(),
  ownerKeys.awayOpen(),
  ownerKeys.rollCallsAll(),
  ownerKeys.actionsAll(),
  ownerKeys.registerAll(),
  // Roll-call and away edits change the credit ledger and what payroll will cut.
  ownerKeys.creditsAll(),
  ownerKeys.payrollAll(),
];

/** Done: save the roll-call, or save it again to edit the marks (`rollcall.edit`). */
export function useRollCallSubmit(id: string) {
  return useOwnerMutation<{ notHere: string[]; here: string[] }, RollCallResult>({
    run: (api, body, call) =>
      api.ownerRollCallSubmit(
        {
          params: { id },
          body: { ...body, idempotencyKey: call.idempotencyKey ?? newIntentKey() },
        },
        call,
      ),
    invalidate: afterPresence,
  });
}

/** Edit start, end, reason or the work flag of an away interval (PRD 4.18.5, 4.19.5). */
export function useAwayPatch() {
  return useOwnerMutation<{ id: string; patch: AwayPatch }, AwayIntervalView>({
    run: (api, v, call) => api.ownerAwayPatch({ params: { id: v.id }, body: v.patch }, call),
    invalidate: afterPresence,
  });
}
