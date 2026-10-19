/** Sign-in and join routes (PRD 4.1, 5.1, 5.2). Owner: WP-3. */
import type { RouteObject } from 'react-router';
import { Placeholder } from '../../app/placeholder';

export const authRoutes: RouteObject[] = [
  { path: '/join/:code', element: <Placeholder titleKey="auth:screens.invite" /> },
  { path: '/join', element: <Placeholder titleKey="auth:screens.join" /> },
  { path: '/waiting', element: <Placeholder titleKey="auth:screens.waiting" /> },
  { path: '/signin', element: <Placeholder titleKey="auth:screens.signIn" /> },
  { path: '/auth/owner', element: <Placeholder titleKey="auth:screens.ownerSignIn" /> },
];
