/**
 * Owner panel routes under /o (PRD 5.2). Owner: WP-6. Children render inside the owner shell
 * (bottom tabs on phones, left rail from 64rem). WP-6 replaces the placeholders.
 */
import type { RouteObject } from 'react-router';
import { Placeholder } from '../../app/placeholder';
import { InboxScreen } from '../inbox';

export const ownerRoutes: RouteObject[] = [
  { path: 'today', element: <Placeholder titleKey="owner:screens.today" /> },
  { path: 'setup', element: <Placeholder titleKey="owner:screens.setup" /> },
  { path: 'actions', element: <Placeholder titleKey="owner:screens.actions" /> },
  { path: 'register', element: <Placeholder titleKey="owner:screens.register" /> },
  { path: 'register/:userId/:date', element: <Placeholder titleKey="owner:screens.day" /> },
  { path: 'staff', element: <Placeholder titleKey="owner:screens.staff" /> },
  { path: 'staff/new', element: <Placeholder titleKey="owner:screens.addStaff" /> },
  { path: 'staff/:id', element: <Placeholder titleKey="owner:screens.staffProfile" /> },
  { path: 'roster', element: <Placeholder titleKey="owner:screens.roster" /> },
  { path: 'duties/new', element: <Placeholder titleKey="owner:screens.dutyForm" /> },
  { path: 'payroll', element: <Placeholder titleKey="owner:screens.payroll" /> },
  { path: 'payroll/:runId', element: <Placeholder titleKey="owner:screens.payrollRun" /> },
  {
    path: 'payroll/:runId/:userId',
    element: <Placeholder titleKey="owner:screens.payslipReview" />,
  },
  { path: 'advances', element: <Placeholder titleKey="owner:screens.advances" /> },
  { path: 'reports', element: <Placeholder titleKey="owner:screens.reports" /> },
  { path: 'door-code', element: <Placeholder titleKey="owner:screens.doorCode" /> },
  { path: 'inbox', element: <InboxScreen /> },
  { path: 'more', element: <Placeholder titleKey="owner:nav.more" /> },
  { path: 'settings/*', element: <Placeholder titleKey="owner:screens.settings" /> },
  { path: 'settings/audit', element: <Placeholder titleKey="owner:screens.audit" /> },
];

/** Layout around owner routes. WP-6 builds it. */
export { Outlet as OwnerShell } from 'react-router';
