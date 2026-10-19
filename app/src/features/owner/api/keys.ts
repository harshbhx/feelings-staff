/**
 * TanStack Query keys for the owner panel. Everything lives under `['owner', ...]` so a push or a
 * sign-out can invalidate the whole panel at once.
 */
import type { ActionType, AuditCategory } from '@fs/contracts';

export type StaffStatusFilter = 'active' | 'invited' | 'exited' | 'all';

export interface AuditFilter {
  entity?: string;
  category?: AuditCategory;
  from?: string;
  to?: string;
}

export const ownerKeys = {
  all: ['owner'] as const,
  today: () => ['owner', 'today'] as const,
  actions: (type?: ActionType) => ['owner', 'actions', type ?? 'all'] as const,
  actionsAll: () => ['owner', 'actions'] as const,
  register: (month: string) => ['owner', 'register', month] as const,
  registerAll: () => ['owner', 'register'] as const,
  day: (userId: string, date: string) => ['owner', 'day', userId, date] as const,
  staffList: (status: StaffStatusFilter, q: string) =>
    ['owner', 'staff', 'list', status, q] as const,
  staffAll: () => ['owner', 'staff'] as const,
  staff: (id: string) => ['owner', 'staff', 'one', id] as const,
  staffLeave: (id: string) => ['owner', 'staff', 'leave', id] as const,
  roster: (week: string) => ['owner', 'roster', week] as const,
  rosterAll: () => ['owner', 'roster'] as const,
  templates: () => ['owner', 'templates'] as const,
  holidays: (year: number) => ['owner', 'holidays', year] as const,
  blackouts: (year: number) => ['owner', 'blackouts', year] as const,
  sites: () => ['owner', 'sites'] as const,
  calibration: (siteId: string) => ['owner', 'calibration', siteId] as const,
  duties: (from: string, to: string) => ['owner', 'duties', from, to] as const,
  dutiesAll: () => ['owner', 'duties'] as const,
  duty: (id: string) => ['owner', 'duty', id] as const,
  doorCode: () => ['owner', 'door-code'] as const,
  doorDevices: () => ['owner', 'door-devices'] as const,
  advances: (userId?: string, status?: 'open' | 'all') =>
    ['owner', 'advances', userId ?? 'everyone', status ?? 'open'] as const,
  advancesAll: () => ['owner', 'advances'] as const,
  advance: (id: string) => ['owner', 'advance', id] as const,
  payrollRuns: () => ['owner', 'payroll', 'runs'] as const,
  payrollAll: () => ['owner', 'payroll'] as const,
  payrollRun: (id: string) => ['owner', 'payroll', 'run', id] as const,
  payrollPreview: (month: string) => ['owner', 'payroll', 'preview', month] as const,
  payslip: (runId: string, userId: string) =>
    ['owner', 'payroll', 'payslip', runId, userId] as const,
  exports: () => ['owner', 'exports'] as const,
  exportOne: (id: string) => ['owner', 'export', id] as const,
  settings: () => ['owner', 'settings'] as const,
  setup: () => ['owner', 'setup'] as const,
  security: () => ['owner', 'security'] as const,
  audit: (f: AuditFilter) =>
    ['owner', 'audit', f.entity ?? '', f.category ?? '', f.from ?? '', f.to ?? ''] as const,
  managers: () => ['owner', 'managers'] as const,
  rollCallsAll: () => ['owner', 'roll-calls'] as const,
  rollCalls: () => ['owner', 'roll-calls', 'today'] as const,
  rollCall: (id: string) => ['owner', 'roll-calls', 'one', id] as const,
};
