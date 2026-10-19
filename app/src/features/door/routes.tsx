/** Door kiosk (PRD 4.5). Owner: WP-4 (logic and UI). Lazy: the QR encoder only loads here. */
import type { RouteObject } from 'react-router';

export const doorRoutes: RouteObject[] = [
  {
    path: '/door',
    lazy: () => import('./DoorScreen').then((m) => ({ Component: m.DoorScreen })),
  },
];
