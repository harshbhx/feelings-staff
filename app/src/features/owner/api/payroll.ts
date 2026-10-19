/**
 * Payroll, payslips, advances and exports (PRD 4.10, 4.13, 4.14, 4.16; endpoints by WP-5).
 */
import type {
  AdjustmentCreate,
  AdvanceCreate,
  ExportRequest,
  ExportView,
  OwnerPayslipView,
  PayMode,
  PayrollRunView,
} from '@fs/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../../api/provider';
import { ownerKeys } from './keys';
import { ownerQuery, useOwnerMutation } from './query';

export function usePayrollRuns() {
  const api = useApi();
  return useQuery(
    ownerQuery('ownerPayrollRuns', ownerKeys.payrollRuns(), () => api.ownerPayrollRuns()),
  );
}

export function usePayrollRun(id: string) {
  const api = useApi();
  return useQuery(
    ownerQuery('ownerPayrollGet', ownerKeys.payrollRun(id), () =>
      api.ownerPayrollGet({ params: { id } }),
    ),
  );
}

/** "Payroll so far" for the current month (read-only, PRD 4.13.1). */
export function usePayrollPreview(month: string, enabled = true) {
  const api = useApi();
  return useQuery({
    ...ownerQuery('ownerPayrollPreview', ownerKeys.payrollPreview(month), () =>
      api.ownerPayrollPreview({ query: { month } }),
    ),
    enabled,
  });
}

export function usePayslipReview(runId: string, userId: string) {
  const api = useApi();
  return useQuery(
    ownerQuery('ownerPayslipPreview', ownerKeys.payslip(runId, userId), () =>
      api.ownerPayslipPreview({ params: { id: runId, userId } }),
    ),
  );
}

function usePutRun() {
  const qc = useQueryClient();
  return (view: PayrollRunView) => qc.setQueryData(ownerKeys.payrollRun(view.run.id), view);
}

function usePutPayslip(runId: string) {
  const qc = useQueryClient();
  return (view: OwnerPayslipView) =>
    qc.setQueryData(ownerKeys.payslip(runId, view.person.id), view);
}

export function useStartPayroll() {
  const put = usePutRun();
  return useOwnerMutation({
    run: (api, month: string, call) => api.ownerPayrollCreate({ body: { month } }, call),
    onSuccess: put,
    invalidate: () => [ownerKeys.payrollRuns()],
  });
}

export function useRecompute(runId: string) {
  const put = usePutRun();
  return useOwnerMutation({
    run: (api, _v: undefined, call) => api.ownerPayrollRecompute({ params: { id: runId } }, call),
    onSuccess: put,
    invalidate: () => [ownerKeys.payrollRuns(), ownerKeys.payrollAll()],
  });
}

/** Finalise (step-up, PRD 4.13.4). `acceptDefaults` is true after "Finalise anyway". */
export function useFinalise(runId: string) {
  const put = usePutRun();
  return useOwnerMutation({
    run: (api, acceptDefaults: boolean, call) =>
      api.ownerPayrollFinalise({ params: { id: runId }, body: { acceptDefaults } }, call),
    onSuccess: put,
    invalidate: () => [ownerKeys.payrollAll(), ownerKeys.registerAll()],
  });
}

export function useReopen(runId: string) {
  const put = usePutRun();
  return useOwnerMutation({
    run: (api, body: { reason: string; settleMode: 'next_month' | 'reissue' }, call) =>
      api.ownerPayrollReopen({ params: { id: runId }, body }, call),
    onSuccess: put,
    invalidate: () => [ownerKeys.payrollAll(), ownerKeys.registerAll()],
  });
}

export interface PaidVars {
  paidOn: string;
  mode: PayMode;
  ref?: string;
}

function paidBody(v: PaidVars) {
  return v.ref
    ? { paidOn: v.paidOn, mode: v.mode, ref: v.ref }
    : { paidOn: v.paidOn, mode: v.mode };
}

export function useMarkAllPaid(runId: string) {
  const put = usePutRun();
  return useOwnerMutation({
    run: (api, v: PaidVars, call) =>
      api.ownerPayrollMarkAllPaid({ params: { id: runId }, body: paidBody(v) }, call),
    onSuccess: put,
    invalidate: () => [ownerKeys.payrollAll()],
  });
}

export function useMarkPaid(runId: string) {
  const put = usePutPayslip(runId);
  return useOwnerMutation({
    run: (api, v: PaidVars & { payslipId: string }, call) =>
      api.ownerPayslipMarkPaid({ params: { id: v.payslipId }, body: paidBody(v) }, call),
    onSuccess: put,
    invalidate: () => [ownerKeys.payrollRun(runId), ownerKeys.payrollRuns()],
  });
}

export function useAddAdjustment(runId: string) {
  const put = usePutPayslip(runId);
  return useOwnerMutation({
    run: (api, body: AdjustmentCreate, call) =>
      api.ownerAdjustmentAdd({ params: { id: runId }, body }, call),
    onSuccess: put,
    invalidate: () => [ownerKeys.payrollRun(runId)],
  });
}

export function useDeleteAdjustment(runId: string) {
  const put = usePutPayslip(runId);
  return useOwnerMutation({
    run: (api, adjId: string, call) =>
      api.ownerAdjustmentDelete({ params: { id: runId, adjId } }, call),
    onSuccess: put,
    invalidate: () => [ownerKeys.payrollRun(runId)],
  });
}

export function useChangeRecovery(runId: string) {
  const put = usePutPayslip(runId);
  return useOwnerMutation({
    run: (api, body: { userId: string; advanceId: string; recoverPaise: number }, call) =>
      api.ownerAdvanceRecovery({ params: { id: runId }, body }, call),
    onSuccess: put,
    invalidate: () => [ownerKeys.payrollRun(runId), ownerKeys.advancesAll()],
  });
}

// ---- Advances -----------------------------------------------------------------------------

export function useAdvances(userId?: string, status: 'open' | 'all' = 'open') {
  const api = useApi();
  return useQuery(
    ownerQuery('ownerAdvancesList', ownerKeys.advances(userId, status), () =>
      api.ownerAdvancesList({ query: userId ? { userId, status } : { status } }),
    ),
  );
}

export function useGiveAdvance() {
  return useOwnerMutation({
    run: (api, body: AdvanceCreate, call) => api.ownerAdvanceCreate({ body }, call),
    invalidate: () => [ownerKeys.advancesAll(), ownerKeys.staffAll(), ownerKeys.payrollAll()],
  });
}

export function useCancelAdvance() {
  return useOwnerMutation({
    run: (api, id: string, call) => api.ownerAdvanceCancel({ params: { id } }, call),
    invalidate: () => [ownerKeys.advancesAll(), ownerKeys.staffAll()],
  });
}

// ---- Exports --------------------------------------------------------------------------------

/** Recent exports; polls every 3 s while one is still being made (PRD 4.16). */
export function useExports() {
  const api = useApi();
  return useQuery({
    ...ownerQuery('ownerExportsList', ownerKeys.exports(), () => api.ownerExportsList()),
    refetchInterval: (query) =>
      (query.state.data as ExportView[] | undefined)?.some((e) => e.status === 'queued')
        ? 3_000
        : false,
  });
}

export function useCreateExport() {
  return useOwnerMutation({
    run: (api, body: ExportRequest, call) => api.ownerExportCreate({ body }, call),
    invalidate: () => [ownerKeys.exports()],
  });
}

/** Session-checked download link for a ready export (never a public R2 URL). */
export function useExportFileUrl() {
  const api = useApi();
  return (id: string) => api.url('ownerExportFile', { params: { id } });
}
