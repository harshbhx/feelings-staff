/**
 * Route table of the owner build (docs/owner-access.md, ADR-19): the owner sign-in and the owner
 * panel only, served on the owner host. Staff screens are not in this build. The panel's route table
 * is added on the first visit under `/o`, as in the combined router.
 */
import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate, type RouteObject } from 'react-router';
import { RequireRole } from './app/guards';
import { WithNamespaces } from './app/i18n';
import { withNamespaces } from './app/with-namespaces-route';
import { ownerAuthRoutes } from './features/auth/routes.owner';

const LazyOwnerShell = lazy(() =>
  import('./features/owner/shell/OwnerShell').then((m) => ({ default: m.OwnerShell })),
);

const OWNER_NS = ['owner', 'payslip'] as const;
// The panel also holds the inbox (/o/inbox), whose copy is not in the staff start catalogs.
const OWNER_SHELL_NS = [...OWNER_NS, 'notify'] as const;

export const routes: RouteObject[] = [
  withNamespaces(OWNER_NS, ownerAuthRoutes),
  {
    id: 'owner',
    path: '/o',
    element: (
      <RequireRole roles={['owner', 'manager']} signIn="/auth/owner">
        <WithNamespaces ns={OWNER_SHELL_NS}>
          <Suspense fallback={null}>
            <LazyOwnerShell />
          </Suspense>
        </WithNamespaces>
      </RequireRole>
    ),
    children: [{ index: true, element: <Navigate to="/o/today" replace /> }],
  },
  { path: '*', element: <Navigate to="/o/today" replace /> },
];

export function createRouter() {
  return createBrowserRouter([{ lazy: () => import('./app/RouteErrorPage'), children: routes }], {
    async patchRoutesOnNavigation({ path, patch }) {
      if (path !== '/o' && !path.startsWith('/o/')) return;
      const { ownerRoutes } = await import('./features/owner/routes');
      patch('owner', ownerRoutes);
    },
  });
}
