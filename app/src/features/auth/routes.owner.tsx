/** Owner sign-in route (`/auth/owner`, PRD 4.1.7, 5.2). Lazy, like the staff sign-in routes. */
import { lazy, Suspense } from 'react';
import type { RouteObject } from 'react-router';

const OwnerSignInScreen = lazy(() =>
  import('./screens/owner-sign-in').then((m) => ({ default: m.OwnerSignInScreen })),
);

export const ownerAuthRoutes: RouteObject[] = [
  {
    path: '/auth/owner',
    element: (
      <Suspense fallback={null}>
        <OwnerSignInScreen />
      </Suspense>
    ),
  },
];
