/** Component kit page (PRD 12.6), preview builds only. Owner: WP-2. */
import type { RouteObject } from 'react-router';
import { Placeholder } from '../../app/placeholder';

export const kitRoutes: RouteObject[] = [
  { path: '/__kit', element: <Placeholder titleKey="common:app.name" /> },
];
