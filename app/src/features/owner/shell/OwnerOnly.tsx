/**
 * Route guard for owner-only screens (Time credits, PRD 7.17.9): a manager, even with every
 * permission, who opens the URL is sent to Today. Renders nothing until the session is known.
 */
import { Navigate, Outlet } from 'react-router';
import { useMe } from '../../../api/hooks';

export function OwnerOnly() {
  const me = useMe();
  if (!me.data) return null;
  return me.data.user.role === 'owner' ? <Outlet /> : <Navigate to="/o/today" replace />;
}
