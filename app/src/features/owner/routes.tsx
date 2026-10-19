/**
 * Owner panel routes under /o (PRD 5.2). Owner: WP-6.
 *
 * Every screen is its own lazy chunk (PRD 11.10: each owner route chunk <= 120 KB gzip), and the
 * shell is lazy too, so nothing here adds to the staff app's initial bundle. `handle.titleKey` is the
 * header title while a screen loads; screens may set a more specific title themselves.
 */
import { lazy, Suspense } from 'react';
import type { RouteObject } from 'react-router';
import { RouteError } from './shell/RouteError';

export interface OwnerRouteHandle {
  titleKey: string;
  /** Detail screens show a back button to this path on phones. */
  back?: string;
}

/** Title (and back link) for the header, and the error card if the screen crashes. */
const h = (titleKey: string, back?: string) => ({
  handle: (back ? { titleKey, back } : { titleKey }) satisfies OwnerRouteHandle,
  errorElement: <RouteError />,
});

export const ownerRoutes: RouteObject[] = [
  {
    path: 'today',
    ...h('owner:screens.today'),
    lazy: () => import('./today/TodayScreen').then((m) => ({ Component: m.TodayScreen })),
  },
  {
    path: 'setup',
    ...h('owner:screens.setup'),
    lazy: () => import('./setup/SetupScreen').then((m) => ({ Component: m.SetupScreen })),
  },
  {
    path: 'actions',
    ...h('owner:screens.actions'),
    lazy: () => import('./actions/ActionsScreen').then((m) => ({ Component: m.ActionsScreen })),
  },
  {
    path: 'register',
    ...h('owner:screens.register'),
    lazy: () => import('./register/RegisterScreen').then((m) => ({ Component: m.RegisterScreen })),
  },
  {
    path: 'register/:userId/:date',
    ...h('owner:screens.day', '/o/register'),
    lazy: () =>
      import('./register/DayDetailScreen').then((m) => ({ Component: m.DayDetailScreen })),
  },
  {
    path: 'staff',
    ...h('owner:screens.staff'),
    lazy: () => import('./staff/StaffListScreen').then((m) => ({ Component: m.StaffListScreen })),
  },
  {
    path: 'staff/new',
    ...h('owner:screens.addStaff', '/o/staff'),
    lazy: () => import('./staff/AddStaffScreen').then((m) => ({ Component: m.AddStaffScreen })),
  },
  {
    path: 'staff/:id',
    ...h('owner:screens.staffProfile', '/o/staff'),
    lazy: () =>
      import('./staff/StaffProfileScreen').then((m) => ({ Component: m.StaffProfileScreen })),
  },
  {
    path: 'roster',
    ...h('owner:screens.roster'),
    lazy: () => import('./roster/RosterScreen').then((m) => ({ Component: m.RosterScreen })),
  },
  {
    path: 'duties/new',
    ...h('owner:screens.dutyForm', '/o/roster'),
    lazy: () => import('./roster/DutyFormScreen').then((m) => ({ Component: m.DutyFormScreen })),
  },
  {
    path: 'payroll',
    ...h('owner:screens.payroll'),
    lazy: () =>
      import('./payroll/PayrollListScreen').then((m) => ({ Component: m.PayrollListScreen })),
  },
  {
    path: 'payroll/:runId',
    ...h('owner:screens.payrollRun', '/o/payroll'),
    lazy: () =>
      import('./payroll/PayrollRunScreen').then((m) => ({ Component: m.PayrollRunScreen })),
  },
  {
    path: 'payroll/:runId/credits',
    ...h('owner:screens.settleCredits'),
    lazy: () =>
      import('./credits/SettleCreditsScreen').then((m) => ({ Component: m.SettleCreditsScreen })),
  },
  {
    path: 'payroll/:runId/:userId',
    ...h('owner:screens.payslipReview'),
    lazy: () =>
      import('./payroll/PayslipReviewScreen').then((m) => ({ Component: m.PayslipReviewScreen })),
  },
  {
    path: 'credits',
    ...h('owner:screens.credits'),
    lazy: () => import('./credits/CreditsScreen').then((m) => ({ Component: m.CreditsScreen })),
  },
  {
    path: 'credits/:userId',
    ...h('owner:screens.creditLedger', '/o/credits'),
    lazy: () =>
      import('./credits/CreditLedgerScreen').then((m) => ({ Component: m.CreditLedgerScreen })),
  },
  {
    path: 'advances',
    ...h('owner:screens.advances'),
    lazy: () => import('./advances/AdvancesScreen').then((m) => ({ Component: m.AdvancesScreen })),
  },
  {
    path: 'reports',
    ...h('owner:screens.reports'),
    lazy: () => import('./reports/ReportsScreen').then((m) => ({ Component: m.ReportsScreen })),
  },
  {
    path: 'door-code',
    ...h('owner:screens.doorCode'),
    lazy: () => import('./door/DoorCodeScreen').then((m) => ({ Component: m.DoorCodeScreen })),
  },
  {
    path: 'inbox',
    ...h('owner:screens.inbox'),
    lazy: () => import('../inbox').then((m) => ({ Component: m.InboxScreen })),
  },
  {
    path: 'more',
    ...h('owner:nav.more'),
    lazy: () => import('./more/MoreScreen').then((m) => ({ Component: m.MoreScreen })),
  },
  {
    // Settings sections, Security and the audit log route inside SettingsRoutes (/o/settings/*).
    path: 'settings/*',
    ...h('owner:screens.settings'),
    lazy: () => import('./settings/SettingsRoutes').then((m) => ({ Component: m.SettingsRoutes })),
  },
];

const LazyShell = lazy(() => import('./shell/OwnerShell').then((m) => ({ default: m.OwnerShell })));

/** Layout around owner routes: bottom tabs on phones, left rail from 64rem, header with the bell. */
export function OwnerShell() {
  return (
    <Suspense fallback={null}>
      <LazyShell />
    </Suspense>
  );
}
