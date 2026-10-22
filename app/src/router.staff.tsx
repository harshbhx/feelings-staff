/**
 * Route table of the staff build (docs/owner-access.md, ADR-19). The same areas as router.tsx minus
 * everything owner: no `/o`, no `/auth/owner`, no owner shell, no lazy owner route table and no
 * component kit page (it renders owner screens). Used when OWNER_HOST is set.
 */
import { createBrowserRouter, type RouteObject } from 'react-router';
import { RequireRole } from './app/guards';
import { withNamespaces } from './app/with-namespaces-route';
import { staffAuthRoutes } from './features/auth/routes.staff';
import { doorRoutes } from './features/door/routes';
import { publicRoutes } from './features/public/routes';
import { StaffShell, staffRoutes } from './features/staff/routes';

const DOOR_NS = ['door'] as const;
const PUBLIC_NS = ['payslip'] as const;

export const routes: RouteObject[] = [
  ...staffAuthRoutes,
  withNamespaces(DOOR_NS, doorRoutes),
  withNamespaces(PUBLIC_NS, publicRoutes),
  {
    path: '/',
    element: (
      <RequireRole roles={['staff']} signIn="/signin">
        <StaffShell />
      </RequireRole>
    ),
    children: staffRoutes,
  },
  { path: '*', lazy: () => import('./app/NotFound') },
];

export function createRouter() {
  return createBrowserRouter([{ lazy: () => import('./app/RouteErrorPage'), children: routes }]);
}
