/** Public pages: payslip verify (PRD 4.14, `/v/:token`). Owner: WP-6. Lazy, outside every shell. */
import type { RouteObject } from 'react-router';

export const publicRoutes: RouteObject[] = [
  {
    path: '/v/:token',
    lazy: () => import('./VerifyScreen').then((m) => ({ Component: m.VerifyScreen })),
  },
];
