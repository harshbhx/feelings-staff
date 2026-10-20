/**
 * Route table (WP-1, shared). Every area is mounted here once; packages add screens inside their own
 * routes.tsx and never edit this file (PRD 16.1 rule 2).
 */
import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate, Outlet, type RouteObject } from 'react-router';
import { RequireRole } from './app/guards';
import { WithNamespaces } from './app/i18n';
import { authRoutes } from './features/auth/routes';
import { doorRoutes } from './features/door/routes';
import { kitRoutes } from './features/kit/routes';
import { publicRoutes } from './features/public/routes';
import { StaffShell, staffRoutes } from './features/staff/routes';

// The owner panel never loads for staff: its shell and its route table are separate chunks, and the
// table is added to the router on the first visit under /o (see createRouter).
const LazyOwnerShell = lazy(() =>
  import('./features/owner/shell/OwnerShell').then((m) => ({ default: m.OwnerShell })),
);

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
    id: 'owner',
    path: '/o',
    element: (
      <RequireRole roles={['owner', 'manager']} signIn="/auth/owner">
        <WithNamespaces ns={OWNER_NS}>
          <Suspense fallback={null}>
            <LazyOwnerShell />
          </Suspense>
        </WithNamespaces>
      </RequireRole>
    ),
    children: [{ index: true, element: <Navigate to="/o/today" replace /> }],
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
  // One root error page (its own chunk) for every area, including a failed load of the owner routes.
  return createBrowserRouter(
    [
      {
        lazy: () => import('./app/RouteErrorPage'),
        children: routes,
      },
    ],
    {
      async patchRoutesOnNavigation({ path, patch }) {
        if (path !== '/o' && !path.startsWith('/o/')) return;
        const { ownerRoutes } = await import('./features/owner/routes');
        patch('owner', ownerRoutes);
      },
    },
  );
}
