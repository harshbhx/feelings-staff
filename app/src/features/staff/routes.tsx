/**
 * Staff app routes (PRD 5.1). Owner: WP-7. Children render inside the staff shell (tab bar,
 * install gate). WP-7 replaces the placeholders with real screens in this folder.
 */
import type { RouteObject } from 'react-router';
import { Placeholder } from '../../app/placeholder';
import { InboxScreen } from '../inbox';

export const staffRoutes: RouteObject[] = [
  { index: true, element: <Placeholder titleKey="staff:screens.today" /> },
  { path: 'month', element: <Placeholder titleKey="staff:screens.month" /> },
  { path: 'day/:date', element: <Placeholder titleKey="staff:screens.day" /> },
  { path: 'requests', element: <Placeholder titleKey="staff:screens.requests" /> },
  { path: 'requests/leave', element: <Placeholder titleKey="staff:screens.leaveForm" /> },
  { path: 'requests/fix', element: <Placeholder titleKey="staff:screens.fixForm" /> },
  { path: 'payslips', element: <Placeholder titleKey="staff:screens.payslips" /> },
  { path: 'payslips/:id', element: <Placeholder titleKey="staff:screens.payslip" /> },
  { path: 'inbox', element: <InboxScreen /> },
  { path: 'me', element: <Placeholder titleKey="staff:screens.me" /> },
  { path: 'me/data', element: <Placeholder titleKey="staff:screens.myData" /> },
  { path: 'me/privacy', element: <Placeholder titleKey="staff:screens.privacy" /> },
  { path: 'scan', element: <Placeholder titleKey="staff:screens.scan" /> },
];

/** Layout around staff routes (tab bar, header, install gate). WP-7 builds it. */
export { Outlet as StaffShell } from 'react-router';
