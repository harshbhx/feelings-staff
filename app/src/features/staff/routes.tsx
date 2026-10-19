/**
 * Staff app routes (PRD 5.1). Owner: WP-7. Today, the shell and the check-in sheet are in the
 * initial bundle; every other screen is its own lazy chunk (PRD 11.10: staff initial JS <= 170 KB).
 */
import { lazy } from 'react';
import type { RouteObject } from 'react-router';
import { WithNamespaces } from '../../app/i18n';
import { InboxScreen } from '../inbox';
import { browserAllowed } from './install/allow-browser';
import { TodayScreen } from './today/TodayScreen';

const MonthScreen = lazy(() =>
  import('./month/MonthScreen').then((m) => ({ default: m.MonthScreen })),
);
const DayScreen = lazy(() => import('./month/DayScreen').then((m) => ({ default: m.DayScreen })));
const RequestsScreen = lazy(() =>
  import('./requests/RequestsScreen').then((m) => ({ default: m.RequestsScreen })),
);
const LeaveFormScreen = lazy(() =>
  import('./requests/LeaveFormScreen').then((m) => ({ default: m.LeaveFormScreen })),
);
const FixFormScreen = lazy(() =>
  import('./requests/FixFormScreen').then((m) => ({ default: m.FixFormScreen })),
);
const PayslipsScreen = lazy(() =>
  import('./payslips/PayslipsScreen').then((m) => ({ default: m.PayslipsScreen })),
);
const PayslipScreen = lazy(() =>
  import('./payslips/PayslipScreen').then((m) => ({ default: m.PayslipScreen })),
);
const MeScreen = lazy(() => import('./me/MeScreen').then((m) => ({ default: m.MeScreen })));
const MyDataScreen = lazy(() =>
  import('./me/MyDataScreen').then((m) => ({ default: m.MyDataScreen })),
);
const PrivacyScreen = lazy(() =>
  import('./me/PrivacyScreen').then((m) => ({ default: m.PrivacyScreen })),
);
const ScanScreen = lazy(() => import('./scan/ScanScreen').then((m) => ({ default: m.ScanScreen })));
const FixItScreen = lazy(() =>
  import('./fixit/FixItScreen').then((m) => ({ default: m.FixItScreen })),
);

// Remember `?allowBrowser=1` from the URL the tab opened with (often /signin, before the guard
// redirects and the query is lost). Non-production hosts only; see install/allow-browser.ts.
if (typeof window !== 'undefined') browserAllowed();

const PAYSLIP_NS = ['payslip'] as const;

export const staffRoutes: RouteObject[] = [
  { index: true, element: <TodayScreen /> },
  { path: 'month', element: <MonthScreen /> },
  { path: 'day/:date', element: <DayScreen /> },
  { path: 'requests', element: <RequestsScreen /> },
  { path: 'requests/leave', element: <LeaveFormScreen /> },
  { path: 'requests/fix', element: <FixFormScreen /> },
  { path: 'payslips', element: <PayslipsScreen /> },
  {
    // The payslip view uses the `payslip` catalog (days, rate, leave balances); not a staff-start one.
    path: 'payslips/:id',
    element: (
      <WithNamespaces ns={PAYSLIP_NS}>
        <PayslipScreen />
      </WithNamespaces>
    ),
  },
  { path: 'inbox', element: <InboxScreen /> },
  { path: 'me', element: <MeScreen /> },
  { path: 'me/data', element: <MyDataScreen /> },
  { path: 'me/privacy', element: <PrivacyScreen /> },
  { path: 'scan', element: <ScanScreen /> },
  { path: 'fix/:topic', element: <FixItScreen /> },
];

/** Layout around staff routes: install gate, tab bar, update toast (shell/StaffShell.tsx). */
export { StaffShell } from './shell/StaffShell';
