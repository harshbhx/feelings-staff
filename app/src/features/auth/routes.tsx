/**
 * Sign-in and join routes (PRD 4.1, 5.1, 5.2). Owner: WP-3.
 * Screens load on demand so they stay out of the staff Today bundle (PRD 11.10). The install
 * prompt listener starts here, with the router, so `beforeinstallprompt` is never missed.
 */
import { lazy, type ReactNode, Suspense } from 'react';
import type { RouteObject } from 'react-router';
import { captureInstallPrompt } from './lib/install-prompt';

captureInstallPrompt();

const InviteScreen = lazy(() =>
  import('./screens/invite').then((m) => ({ default: m.InviteScreen })),
);
const JoinScreen = lazy(() => import('./screens/join').then((m) => ({ default: m.JoinScreen })));
const WaitingScreen = lazy(() =>
  import('./screens/waiting').then((m) => ({ default: m.WaitingScreen })),
);
const SignInScreen = lazy(() =>
  import('./screens/sign-in').then((m) => ({ default: m.SignInScreen })),
);
const OwnerSignInScreen = lazy(() =>
  import('./screens/owner-sign-in').then((m) => ({ default: m.OwnerSignInScreen })),
);

/** No spinner while a screen loads (PRD 12.8): the white page simply stays for a moment. */
function Load({ children }: { children: ReactNode }) {
  return <Suspense fallback={null}>{children}</Suspense>;
}

export const authRoutes: RouteObject[] = [
  {
    path: '/join/:code',
    element: (
      <Load>
        <InviteScreen />
      </Load>
    ),
  },
  {
    path: '/join',
    element: (
      <Load>
        <JoinScreen />
      </Load>
    ),
  },
  {
    path: '/waiting',
    element: (
      <Load>
        <WaitingScreen />
      </Load>
    ),
  },
  {
    path: '/signin',
    element: (
      <Load>
        <SignInScreen />
      </Load>
    ),
  },
  {
    path: '/auth/owner',
    element: (
      <Load>
        <OwnerSignInScreen />
      </Load>
    ),
  },
];
