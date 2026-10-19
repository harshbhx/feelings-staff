/**
 * Route table (WP-1, shared). Every area is mounted here once; packages add screens inside their own
 * routes.tsx and never edit this file (PRD 16.1 rule 2).
 */
import { createBrowserRouter, Navigate, type RouteObject } from 'react-router';
import { RequireRole } from './app/guards';
import { authRoutes } from './features/auth/routes';
import { doorRoutes } from './features/door/routes';
import { kitRoutes } from './features/kit/routes';
import { OwnerShell, ownerRoutes } from './features/owner/routes';
import { publicRoutes } from './features/public/routes';
import { StaffShell, staffRoutes } from './features/staff/routes';

export const routes: RouteObject[] = [
  ...authRoutes,
  ...doorRoutes,
  ...publicRoutes,
  ...kitRoutes,
  {
    path: '/o',
    element: (
      <RequireRole roles={['owner', 'manager']} signIn="/auth/owner">
        <OwnerShell />
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
