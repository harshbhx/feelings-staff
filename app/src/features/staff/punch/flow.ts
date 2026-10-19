/**
 * The punch flow the sheet renders. Mock mode uses the fixture-driven stand-in; otherwise WP-4's
 * `usePunchFlow` from `app/src/lib/punch/`, adapted to `PunchFlow` (until it is on main, the sheet
 * says check-in is not ready on this build instead of faking one).
 *
 * The choice is made once per tab (mock mode cannot change without a reload), so the hook order
 * is stable.
 */
import { mockChoice } from '../../../api/provider';
import { usePunchFlowNotReady, usePunchFlowStub } from './flow-stub';
import type { PunchFlow } from './flow-types';

const useImpl: () => PunchFlow = mockChoice() ? usePunchFlowStub : usePunchFlowNotReady;

export function usePunchSheetFlow(): PunchFlow {
  return useImpl();
}
