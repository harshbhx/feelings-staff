/**
 * Staff app routes (PRD 5.1). Owner: WP-7. Today, the shell and the check-in sheet are in the
 * initial bundle; every other screen is its own lazy chunk (PRD 11.10: staff initial JS <= 170 KB).
 */
import { lazy } from 'react';
import type { RouteObject } from 'react-router';
import { Placeholder } from '../../app/placeholder';
import { InboxScreen } from '../inbox';
import { TodayScreen } from './today/TodayScreen';

const MonthScreen = lazy(() =>
  import('./month/MonthScreen').then((m) => ({ default: m.MonthScreen })),
);
const DayScreen = lazy(() => import('./month/DayScreen').then((m) => ({ default: m.DayScreen })));
const RequestsScreen = lazy(() =>
  import('./requests/RequestsScreen').then((m) => ({ default: m.RequestsScreen })),
);
const ScanScreen = lazy(() => import('./scan/ScanScreen').then((m) => ({ default: m.ScanScreen })));
const FixItScreen = lazy(() =>
  import('./fixit/FixItScreen').then((m) => ({ default: m.FixItScreen })),
);

export const staffRoutes: RouteObject[] = [
  { index: true, element: <TodayScreen /> },
  { path: 'month', element: <MonthScreen /> },
  { path: 'day/:date', element: <DayScreen /> },
  { path: 'requests', element: <RequestsScreen /> },
  { path: 'requests/leave', element: <Placeholder titleKey="staff:screens.leaveForm" /> },
  { path: 'requests/fix', element: <Placeholder titleKey="staff:screens.fixForm" /> },
  { path: 'payslips', element: <Placeholder titleKey="staff:screens.payslips" /> },
  { path: 'payslips/:id', element: <Placeholder titleKey="staff:screens.payslip" /> },
  { path: 'inbox', element: <InboxScreen /> },
  { path: 'me', element: <Placeholder titleKey="staff:screens.me" /> },
  { path: 'me/data', element: <Placeholder titleKey="staff:screens.myData" /> },
  { path: 'me/privacy', element: <Placeholder titleKey="staff:screens.privacy" /> },
  { path: 'scan', element: <ScanScreen /> },
  { path: 'fix/:topic', element: <FixItScreen /> },
];

/** Layout around staff routes: install gate, tab bar, update toast (shell/StaffShell.tsx). */
export { StaffShell } from './shell/StaffShell';
