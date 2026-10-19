/**
 * Query and mutation hooks for the live board, the Needs-action queue, the register and day detail
 * (PRD 4.12, 5.2; endpoints by WP-4). Screens never call the client directly.
 */
import type { ActionsView, ActionType, DayOverrideRequest, OwnerDayDetail } from '@fs/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../../api/provider';
import type { BulkType } from '../actions/actions-model';
import { ownerKeys } from './keys';
import { ownerQuery, useOwnerMutation } from './query';

/** PRD 5.2: the board polls every 30 s while the page is visible (and refetches on push). */
export const TODAY_POLL_MS = 30_000;
/** The Needs-action count drives the tab badge and the app badge; refresh it every minute. */
export const ACTIONS_POLL_MS = 60_000;

export function useTodayBoard() {
  const api = useApi();
  return useQuery({
    ...ownerQuery('ownerToday', ownerKeys.today(), () => api.ownerToday()),
    refetchInterval: TODAY_POLL_MS,
    refetchIntervalInBackground: false,
  });
}

export function useActions(type?: ActionType) {
  const api = useApi();
  return useQuery({
    ...ownerQuery('ownerActions', ownerKeys.actions(type), () =>
      api.ownerActions({ query: type ? { type } : {} }),
    ),
    refetchInterval: ACTIONS_POLL_MS,
    refetchIntervalInBackground: false,
  });
}

/** Remove decided items from every cached queue at once, so the list updates without a wait. */
function useDropFromQueues() {
  const qc = useQueryClient();
  return (ids: readonly string[]) => {
    const gone = new Set(ids);
    qc.setQueriesData<ActionsView>({ queryKey: ownerKeys.actionsAll() }, (view) => {
      if (!view) return view;
      const removed = view.items.filter((i) => gone.has(i.id));
      if (removed.length === 0) return view;
      const counts = { ...view.counts };
      for (const r of removed) counts[r.type] = Math.max(0, (counts[r.type] ?? 0) - 1);
      return { items: view.items.filter((i) => !gone.has(i.id)), counts };
    });
  };
}

const afterDecision = () => [ownerKeys.actionsAll(), ownerKeys.today(), ownerKeys.registerAll()];

/** A decision on one Needs-action item (PRD 4.12). `id` is the queue item id. */
export type Decision =
  | {
      type: 'flagged_punch' | 'pending_punch';
      id: string;
      punchId: string;
      decision: 'clear' | 'approve' | 'reject';
      note?: string;
    }
  | { type: 'new_device'; id: string; deviceId: string; decision: Verdict; note?: string }
  | { type: 'leave_request'; id: string; requestId: string; decision: Verdict; note?: string }
  | { type: 'regularisation'; id: string; requestId: string; decision: Verdict; note?: string }
  | {
      type: 'overtime';
      id: string;
      userId: string;
      workDate: string;
      /** 0 rejects; otherwise a multiple of the overtime block. */
      approvedMin: number;
      note?: string;
    }
  | {
      type: 'offsite_request';
      id: string;
      punchId: string;
      decision: 'approve' | 'approve_and_open' | 'reject';
      staffIds?: string[];
      note?: string;
    }
  | { type: 'auto_closed'; id: string; userId: string; workDate: string; outTs: number | null }
  | { type: 'advance_request'; id: string; advanceId: string; decision: Verdict; note?: string };

export type Verdict = 'approve' | 'reject';

function noteOf(d: { note?: string }): { note?: string } {
  return d.note ? { note: d.note } : {};
}

/** One mutation for every Needs-action decision (PRD 4.12); devices go through step-up. */
export function useDecide() {
  const drop = useDropFromQueues();
  return useOwnerMutation<Decision, unknown>({
    run: async (api, d, call) => {
      switch (d.type) {
        case 'flagged_punch':
        case 'pending_punch':
          return api.ownerPunchReview(
            { params: { id: d.punchId }, body: { decision: d.decision, ...noteOf(d) } },
            call,
          );
        case 'new_device':
          return api.ownerDeviceDecide(
            { params: { id: d.deviceId }, body: { decision: d.decision, ...noteOf(d) } },
            call,
          );
        case 'leave_request':
          return api.ownerLeaveDecide(
            { params: { id: d.requestId }, body: { decision: d.decision, ...noteOf(d) } },
            call,
          );
        case 'regularisation':
          return api.ownerRegularisationDecide(
            { params: { id: d.requestId }, body: { decision: d.decision, ...noteOf(d) } },
            call,
          );
        case 'overtime':
          return api.ownerOvertimeDecide(
            {
              params: { userId: d.userId, date: d.workDate },
              body: { approvedMin: d.approvedMin, ...noteOf(d) },
            },
            call,
          );
        case 'offsite_request':
          return api.ownerOffsiteDecide(
            {
              params: { punchId: d.punchId },
              body: {
                decision: d.decision,
                ...(d.staffIds ? { staffIds: d.staffIds } : {}),
                ...noteOf(d),
              },
            },
            call,
          );
        case 'auto_closed':
          return api.ownerAutoCloseDecide(
            {
              params: { userId: d.userId, date: d.workDate },
              body: d.outTs === null ? { keep: true } : { outTs: d.outTs },
            },
            call,
          );
        case 'advance_request':
          return api.ownerAdvanceDecide(
            { params: { id: d.advanceId }, body: { decision: d.decision, ...noteOf(d) } },
            call,
          );
      }
    },
    onSuccess: (_data, d) => drop([d.id]),
    invalidate: afterDecision,
  });
}

/** Bulk approve of one type (never devices, PRD 4.12). */
export function useBulkApprove() {
  const drop = useDropFromQueues();
  return useOwnerMutation<
    { type: BulkType; ids: string[] },
    { done: string[]; failed: { id: string; code: string }[] }
  >({
    run: (api, v, call) =>
      api.ownerActionsBulk(
        {
          body: {
            type: v.type,
            ids: v.ids,
            decision: v.type === 'flagged_punch' ? 'clear' : 'approve',
          },
        },
        call,
      ),
    onSuccess: (res) => drop(res.done),
    invalidate: afterDecision,
  });
}

export function useRegister(month: string) {
  const api = useApi();
  return useQuery({
    ...ownerQuery('ownerRegister', ownerKeys.register(month), () =>
      api.ownerRegister({ query: { month } }),
    ),
    placeholderData: (prev) => prev,
  });
}

export function useOwnerDay(userId: string, date: string) {
  const api = useApi();
  return useQuery(
    ownerQuery('ownerDay', ownerKeys.day(userId, date), () =>
      api.ownerDay({ params: { userId, date } }),
    ),
  );
}

export function useDayOverride(userId: string, date: string) {
  const qc = useQueryClient();
  return useOwnerMutation<DayOverrideRequest, OwnerDayDetail>({
    run: (api, body, call) => api.ownerDayOverride({ params: { userId, date }, body }, call),
    onSuccess: (day) => qc.setQueryData(ownerKeys.day(userId, date), day),
    invalidate: () => [ownerKeys.registerAll(), ownerKeys.today(), ownerKeys.payrollAll()],
  });
}
