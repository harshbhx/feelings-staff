/** Public pages: payslip verify (PRD 4.14). Owner: WP-6. */
import type { RouteObject } from 'react-router';
import { Placeholder } from '../../app/placeholder';

export const publicRoutes: RouteObject[] = [
  { path: '/v/:token', element: <Placeholder titleKey="owner:screens.verify" /> },
];
