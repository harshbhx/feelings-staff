/**
 * Staff query hooks over the contract endpoints (PRD 5.1, 9.4). Screens never call fetch directly.
 * Query keys live under `staff` so invalidating `me` (WP-1's key) does not refetch every screen.
 */
import type { LeaveRequestCreate, Me, RegularisationCreate } from '@fs/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMe } from '../../api/hooks';
import { useApi } from '../../api/provider';

export const staffKeys = {
  all: ['staff'] as const,
  today: ['staff', 'today'] as const,
  month: (month: string) => ['staff', 'month', month] as const,
  day: (date: string) => ['staff', 'day', date] as const,
  leave: ['staff', 'leave'] as const,
  regularisations: ['staff', 'regularisations'] as const,
  payslips: ['staff', 'payslips'] as const,
  payslip: (id: string) => ['staff', 'payslip', id] as const,
  data: ['staff', 'data'] as const,
  config: ['staff', 'config'] as const,
};

/** The signed-in staff member. The shell only renders once `useMe` has data. */
export function useStaffMe(): Me {
  const me = useMe();
  if (!me.data) throw new Error('useStaffMe outside the staff shell');
  return me.data;
}

/** The owner's display name for copy ("Send to Urmi"), from settings, never hard-coded. */
export function useOwnerName(): string {
  return useMe().data?.org.ownerDisplayName ?? '';
}

export function useToday() {
  const api = useApi();
  return useQuery({
    queryKey: staffKeys.today,
    queryFn: () => api.meToday(),
    // Keep the board honest without hammering the server: once a minute while visible.
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}

export function useMonth(month: string) {
  const api = useApi();
  return useQuery({
    queryKey: staffKeys.month(month),
    queryFn: () => api.meDays({ query: { month } }),
  });
}

export function useDay(date: string) {
  const api = useApi();
  return useQuery({
    queryKey: staffKeys.day(date),
    queryFn: () => api.meDay({ params: { date } }),
  });
}

export function useMyLeave() {
  const api = useApi();
  return useQuery({ queryKey: staffKeys.leave, queryFn: () => api.meLeave() });
}

export function useMyRegularisations() {
  const api = useApi();
  return useQuery({
    queryKey: staffKeys.regularisations,
    queryFn: () => api.meRegularisations(),
  });
}

export function usePayslips() {
  const api = useApi();
  return useQuery({ queryKey: staffKeys.payslips, queryFn: () => api.mePayslips() });
}

export function usePayslip(id: string) {
  const api = useApi();
  return useQuery({
    queryKey: staffKeys.payslip(id),
    queryFn: () => api.mePayslip({ params: { id } }),
    // While the PDF is being prepared, look again every 10 s (PRD 4.14 states).
    refetchInterval: (q) => (q.state.data?.pdfStatus === 'pending' ? 10_000 : false),
  });
}

export function useMyData() {
  const api = useApi();
  return useQuery({ queryKey: staffKeys.data, queryFn: () => api.meData() });
}

export function useLeaveCreate() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: LeaveRequestCreate) => api.leaveCreate({ body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: staffKeys.leave });
    },
  });
}

export function useLeaveCancel() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.leaveCancel({ params: { id } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: staffKeys.leave });
    },
  });
}

export function useRegularisationCreate() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RegularisationCreate) => api.regularisationCreate({ body }),
    onSuccess: (reg) => {
      void qc.invalidateQueries({ queryKey: staffKeys.regularisations });
      void qc.invalidateQueries({ queryKey: staffKeys.day(reg.workDate) });
    },
  });
}

export function useRegularisationCancel() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.regularisationCancel({ params: { id } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: staffKeys.regularisations });
    },
  });
}
