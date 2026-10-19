/**
 * Route table (WP-1, shared). Every area is mounted here once; packages add screens inside their own
 * routes.tsx and never edit this file (PRD 16.1 rule 2).
 */
import { createBrowserRouter, Navigate, Outlet, type RouteObject } from 'react-router';
import { RequireRole } from './app/guards';
import { WithNamespaces } from './app/i18n';
import { authRoutes } from './features/auth/routes';
import { doorRoutes } from './features/door/routes';
import { kitRoutes } from './features/kit/routes';
import { OwnerShell, ownerRoutes } from './features/owner/routes';
import { publicRoutes } from './features/public/routes';
import { StaffShell, staffRoutes } from './features/staff/routes';

const OWNER_NS = ['owner', 'payslip'] as const;
const DOOR_NS = ['door'] as const;
const PUBLIC_NS = ['owner', 'payslip'] as const;
const KIT_NS = ['owner', 'payslip', 'door'] as const;

/** A path-less layout route that loads the copy an area needs before it renders. */
function withNamespaces(ns: Parameters<typeof WithNamespaces>[0]['ns'], children: RouteObject[]) {
  return {
    element: (
      <WithNamespaces ns={ns}>
        <Outlet />
      </WithNamespaces>
    ),
    children,
  } satisfies RouteObject;
}

export const routes: RouteObject[] = [
  ...authRoutes,
  withNamespaces(DOOR_NS, doorRoutes),
  withNamespaces(PUBLIC_NS, publicRoutes),
  withNamespaces(KIT_NS, kitRoutes),
  {
    path: '/o',
    element: (
      <RequireRole roles={['owner', 'manager']} signIn="/auth/owner">
        <WithNamespaces ns={OWNER_NS}>
          <OwnerShell />
        </WithNamespaces>
      </RequireRole>
    ),
    children: [{ index: true, element: <Navigate to="/o/today" replace /> }, ...ownerRoutes],
  },
  {
    path: '/',
    element: (
      <RequireRole roles={['staff']} signIn="/signin">
        <StaffShell />
      </RequireRole>
    ),
    children: staffRoutes,
  },
  { path: '*', element: <Navigate to="/" replace /> },
];

export function createRouter() {
  return createBrowserRouter(routes);
}
