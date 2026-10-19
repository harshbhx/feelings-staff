/** Door kiosk (PRD 4.5). Owner: WP-4 (logic and UI). */
import type { RouteObject } from 'react-router';
import { Placeholder } from '../../app/placeholder';

export const doorRoutes: RouteObject[] = [
  { path: '/door', element: <Placeholder titleKey="door:screens.door" /> },
];
