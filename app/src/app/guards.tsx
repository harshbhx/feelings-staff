/**
 * Role guards and homes (WP-1; PRD 5): staff live under `/`, owners and managers under `/o/*`.
 * The staff install gate is WP-7's and wraps the staff shell, not these guards.
 */
import type { Role } from '@fs/contracts';
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useMe } from '../api/hooks';

export function homeFor(role: Role): string {
  return role === 'staff' ? '/' : '/o/today';
}

export function RequireRole({
  roles,
  signIn,
  children,
}: {
  roles: Role[];
  signIn: string;
  children: ReactNode;
}) {
  const me = useMe();
  const location = useLocation();
  if (me.isPending) return null;
  if (!me.data) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`${signIn}?next=${next}`} replace />;
  }
  if (!roles.includes(me.data.user.role))
    return <Navigate to={homeFor(me.data.user.role)} replace />;
  return <>{children}</>;
}
