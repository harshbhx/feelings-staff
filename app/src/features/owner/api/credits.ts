/**
 * Time credits (PRD 4.19, 9.4 "Owner: Time credits and presence"; endpoints by WP-9). Owner only:
 * the overview, one person's ledger with filters and pages, adjustments (add, change, void with a
 * reason) and the Settle credits step of a payroll run.
 */
import type { CreditKind, CreditSettleResult, CreditsSettleView } from '@fs/contracts';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../../api/provider';
import { type LedgerFilter, ownerKeys } from './keys';
import { held, retryUnlessHeld } from './mock-states';
import { ownerQuery, useOwnerMutation } from './query';

export function useCreditsOverview() {
  const api = useApi();
  return useQuery(
    ownerQuery('ownerCredits', ownerKeys.credits(), () => api.ownerCredits({ query: {} })),
  );
}

/** One person's ledger, newest first from the server, a page at a time. */
export function useCreditLedger(userId: string, filter: LedgerFilter) {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: ownerKeys.creditLedger(userId, filter),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      held('ownerCreditLedger', () =>
        api.ownerCreditLedger({
          params: { userId },
          query: {
            ...(filter.kind ? { kind: filter.kind } : {}),
            ...(filter.from ? { from: filter.from } : {}),
            ...(filter.to ? { to: filter.to } : {}),
            ...(filter.unsettled ? { unsettled: 'true' } : {}),
            ...(pageParam ? { cursor: pageParam } : {}),
          },
        }),
      ),
    getNextPageParam: (last) => last.nextCursor,
    retry: retryUnlessHeld('ownerCreditLedger'),
  });
}

/** Adjustments change balances, ledgers and any draft payroll that settles them. */
const afterAdjust = () => [ownerKeys.creditsAll(), ownerKeys.payrollAll()];

export interface AdjustVars {
  workDate: string;
  kind: CreditKind;
  deltaMin: number;
  reason: string;
}

export function useAdjustCredits(userId: string) {
  return useOwnerMutation({
    run: (api, body: AdjustVars, call) =>
      api.ownerCreditAdjustmentCreate({ params: { userId }, body }, call),
    invalidate: afterAdjust,
  });
}

export function useChangeAdjustment() {
  return useOwnerMutation({
    run: (api, v: { id: string; deltaMin: number; reason: string }, call) =>
      api.ownerCreditAdjustmentPatch(
        { params: { id: v.id }, body: { deltaMin: v.deltaMin, reason: v.reason } },
        call,
      ),
    invalidate: afterAdjust,
  });
}

export function useVoidAdjustment() {
  return useOwnerMutation({
    run: (api, v: { id: string; reason: string }, call) =>
      api.ownerCreditAdjustmentVoid({ params: { id: v.id }, body: { reason: v.reason } }, call),
    invalidate: afterAdjust,
  });
}

// ---- Settle credits step of a payroll run ---------------------------------------------------

export function usePayrollCredits(runId: string, enabled = true) {
  const api = useApi();
  return useQuery({
    ...ownerQuery('ownerPayrollCredits', ownerKeys.payrollCredits(runId), () =>
      api.ownerPayrollCredits({ params: { id: runId } }),
    ),
    enabled,
  });
}

/**
 * Save one person's settlement (0 removes it). The saved row comes back at once from the answer
 * (after the 50% cap); the run totals and the payslip refetch.
 */
export function useSettleCredit(runId: string) {
  const qc = useQueryClient();
  return useOwnerMutation({
    run: (api, v: { userId: string; settleMin: number }, call) =>
      api.ownerPayrollCreditSet(
        { params: { id: runId, userId: v.userId }, body: { settleMin: v.settleMin } },
        call,
      ),
    onSuccess: (res: CreditSettleResult, v) =>
      qc.setQueryData<CreditsSettleView>(ownerKeys.payrollCredits(runId), (view) =>
        view
          ? {
              rows: view.rows.map((r) =>
                r.userId === v.userId
                  ? {
                      ...r,
                      settleMin: v.settleMin,
                      appliedMin: res.settlement.appliedMin,
                      amountPaise: res.settlement.amountPaise,
                      stayMin: r.balanceMin - res.settlement.appliedMin,
                    }
                  : r,
              ),
            }
          : view,
      ),
    invalidate: (v) => [
      ownerKeys.payrollRun(runId),
      ownerKeys.payrollRuns(),
      ownerKeys.payslip(runId, v.userId),
      ownerKeys.creditsAll(),
    ],
  });
}
