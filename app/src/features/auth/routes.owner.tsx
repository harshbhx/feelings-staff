/**
 * Owner sign-in routes (PRD 4.1.7, 5.2). Lazy, like the staff sign-in routes.
 *
 * The combined build (OWNER_HOST unset) keeps the email-code screen at `/auth/owner`. The owner build
 * (docs/owner-access.md) signs in with a passkey there; `/auth/owner/email` is the email code for the
 * first device and `/auth/owner/enrol` makes this phone the key. The tables are built in functions so
 * `OWNER_ONLY` folds the passkey screens (and their chunks) out of every other build.
 */
import { lazy, Suspense } from 'react';
import type { RouteObject } from 'react-router';
import { RequireRole } from '../../app/guards';
import { OWNER_ONLY } from '../../lib/surface';

function emailCodeRoutes(): RouteObject[] {
  const OwnerSignInScreen = lazy(() =>
    import('./screens/owner-sign-in').then((m) => ({ default: m.OwnerSignInScreen })),
  );
  return [
    {
      path: '/auth/owner',
      element: (
        <Suspense fallback={null}>
          <OwnerSignInScreen />
        </Suspense>
      ),
    },
  ];
}

function passkeyRoutes(): RouteObject[] {
  const SignIn = lazy(() =>
    import('./screens/owner-passkey').then((m) => ({ default: m.OwnerAccessSignInScreen })),
  );
  const FirstDeviceEmail = lazy(() =>
    import('./screens/owner-passkey').then((m) => ({ default: m.OwnerFirstDeviceEmailScreen })),
  );
  const Enrol = lazy(() =>
    import('./screens/owner-enrol').then((m) => ({ default: m.OwnerEnrolScreen })),
  );
  return [
    {
      path: '/auth/owner',
      element: (
        <Suspense fallback={null}>
          <SignIn />
        </Suspense>
      ),
    },
    {
      path: '/auth/owner/email',
      element: (
        <Suspense fallback={null}>
          <FirstDeviceEmail />
        </Suspense>
      ),
    },
    {
      path: '/auth/owner/enrol',
      element: (
        <RequireRole roles={['owner']} signIn="/auth/owner">
          <Suspense fallback={null}>
            <Enrol />
          </Suspense>
        </RequireRole>
      ),
    },
  ];
}

export const ownerAuthRoutes: RouteObject[] = OWNER_ONLY ? passkeyRoutes() : emailCodeRoutes();
