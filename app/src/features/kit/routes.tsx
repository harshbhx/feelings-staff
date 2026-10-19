/**
 * Component kit page (PRD 12.6), preview builds only: the Worker answers 404 for /__kit in
 * production. Lazy, so it never adds to the initial bundle. Owner: WP-2.
 */
import type { RouteObject } from 'react-router';

export const kitRoutes: RouteObject[] = [
  {
    path: '/__kit',
    lazy: async () => {
      const { KitPage } = await import('./KitPage');
      return { Component: KitPage };
    },
  },
];
