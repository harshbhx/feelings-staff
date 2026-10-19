/**
 * Owner shell (PRD 5.2, 12.5). Behaviour first: step-up provider, push refetch, app badge.
 * The visual chrome (bottom tabs, left rail, header with the bell) is built on the @fs/ui kit.
 */
import { Outlet } from 'react-router';
import { openActionCount } from '../actions/actions-model';
import { useActions } from '../api/attendance';
import { StepUpProvider } from '../lib/step-up';
import { useAppBadge, usePushRefetch } from './hooks';

export function OwnerShell() {
  const actions = useActions();
  usePushRefetch();
  useAppBadge(actions.data ? openActionCount(actions.data) : null);
  return (
    <StepUpProvider renderSheet={() => null}>
      <Outlet />
    </StepUpProvider>
  );
}
