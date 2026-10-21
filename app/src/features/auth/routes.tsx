/**
 * Sign-in and join routes of the combined build (PRD 4.1, 5.1, 5.2). Owner: WP-3.
 * The split builds (docs/owner-access.md) use `routes.staff` and `routes.owner` on their own.
 */
import { ownerAuthRoutes } from './routes.owner';
import { staffAuthRoutes } from './routes.staff';

export const authRoutes = [...staffAuthRoutes, ...ownerAuthRoutes];
