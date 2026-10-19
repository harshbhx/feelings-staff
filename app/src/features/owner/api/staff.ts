/**
 * Staff hooks (PRD 4.1.1-4.1.6, 5.2 Staff; endpoints by WP-3): list, profile, add and invite,
 * re-send invite, reset PIN, edit (salary changes need step-up), exit, rehire, leave, devices.
 */
import type { StaffCreate, StaffDetail, StaffPatch } from '@fs/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../../api/provider';
import { filterStaff } from '../staff/staff-list-model';
import { ownerKeys, type StaffStatusFilter } from './keys';
import { ownerQuery, useOwnerMutation } from './query';

export function useStaffList(status: StaffStatusFilter = 'active', q = '') {
  const api = useApi();
  const query = q.trim();
  return useQuery({
    ...ownerQuery('ownerStaffList', ownerKeys.staffList(status, query), () =>
      api.ownerStaffList({ query: query ? { status, q: query } : { status } }),
    ),
    placeholderData: (prev) => prev,
    select: (rows) => filterStaff(rows, status, query),
  });
}

export function useStaff(id: string) {
  const api = useApi();
  return useQuery(
    ownerQuery('ownerStaffGet', ownerKeys.staff(id), () => api.ownerStaffGet({ params: { id } })),
  );
}

export function useStaffLeave(id: string, enabled = true) {
  const api = useApi();
  return useQuery({
    ...ownerQuery('ownerStaffLeave', ownerKeys.staffLeave(id), () =>
      api.ownerStaffLeave({ params: { id } }),
    ),
    enabled,
  });
}

function usePutStaff() {
  const qc = useQueryClient();
  return (staff: StaffDetail) => qc.setQueryData(ownerKeys.staff(staff.id), staff);
}

const afterStaffChange = () => [
  ownerKeys.staffAll(),
  ownerKeys.today(),
  ownerKeys.rosterAll(),
  ownerKeys.registerAll(),
];

export function useCreateStaff() {
  const put = usePutStaff();
  return useOwnerMutation({
    run: (api, body: StaffCreate, call) => api.ownerStaffCreate({ body }, call),
    onSuccess: (res) => put(res.staff),
    invalidate: afterStaffChange,
  });
}

export function usePatchStaff(id: string) {
  const put = usePutStaff();
  return useOwnerMutation({
    run: (api, body: StaffPatch, call) => api.ownerStaffPatch({ params: { id }, body }, call),
    onSuccess: put,
    invalidate: () => [...afterStaffChange(), ownerKeys.payrollAll()],
  });
}

export function useReinvite(id: string) {
  return useOwnerMutation({
    run: (api, _v: undefined, call) => api.ownerStaffInvite({ params: { id } }, call),
    invalidate: () => [ownerKeys.staff(id)],
  });
}

export function useResetPin(id: string) {
  return useOwnerMutation({
    run: (api, _v: undefined, call) => api.ownerStaffResetPin({ params: { id } }, call),
    invalidate: () => [ownerKeys.staff(id)],
  });
}

export function useExitStaff(id: string) {
  const put = usePutStaff();
  return useOwnerMutation({
    run: (api, body: { lastDay: string; reason: string }, call) =>
      api.ownerStaffExit({ params: { id }, body }, call),
    onSuccess: put,
    invalidate: afterStaffChange,
  });
}

export function useRehire() {
  const put = usePutStaff();
  return useOwnerMutation({
    run: (api, v: { id: string; joinDate: string }, call) =>
      api.ownerStaffRehire({ params: { id: v.id }, body: { joinDate: v.joinDate } }, call),
    onSuccess: (res) => put(res.staff),
    invalidate: afterStaffChange,
  });
}

export function useLeaveAdjust(id: string) {
  const qc = useQueryClient();
  return useOwnerMutation({
    run: (
      api,
      body: { code: 'CL' | 'SL' | 'EL' | 'CO' | 'LOP'; days: number; note: string },
      call,
    ) => api.ownerStaffLeaveAdjust({ params: { id }, body }, call),
    onSuccess: (view) => qc.setQueryData(ownerKeys.staffLeave(id), view),
    invalidate: () => [ownerKeys.staff(id)],
  });
}

export function useRevokeDevice(staffId: string) {
  return useOwnerMutation({
    run: (api, v: { deviceId: string; reason: string }, call) =>
      api.ownerDeviceRevoke({ params: { id: v.deviceId }, body: { reason: v.reason } }, call),
    invalidate: () => [ownerKeys.staff(staffId), ownerKeys.staffAll()],
  });
}

/** Approve or reject a pending phone from the profile (same endpoint as Needs action). */
export function useDecideDevice(staffId: string) {
  return useOwnerMutation({
    run: (api, v: { deviceId: string; decision: 'approve' | 'reject' }, call) =>
      api.ownerDeviceDecide({ params: { id: v.deviceId }, body: { decision: v.decision } }, call),
    invalidate: () => [ownerKeys.staff(staffId), ownerKeys.staffAll(), ownerKeys.actionsAll()],
  });
}
