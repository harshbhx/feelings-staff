/** Sign-in and join routes (PRD 4.1, 5.1, 5.2). Owner: WP-3. */
import type { RouteObject } from 'react-router';
import { Placeholder } from '../../app/placeholder';

export const authRoutes: RouteObject[] = [
  { path: '/join/:code', element: <Placeholder titleKey="staff:screens.invite" /> },
  { path: '/join', element: <Placeholder titleKey="staff:screens.join" /> },
  { path: '/waiting', element: <Placeholder titleKey="staff:screens.waiting" /> },
  { path: '/signin', element: <Placeholder titleKey="staff:screens.signIn" /> },
  { path: '/auth/owner', element: <Placeholder titleKey="owner:screens.signIn" /> },
];
