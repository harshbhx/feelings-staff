/**
 * The punch flow the sheet renders: WP-4's `usePunchFlow` through `flow-live.ts`, or in localhost
 * mock mode (visual tests) the fixture-driven stand-in in `flow-stub.ts`.
 *
 * The choice is made once per tab (mock mode cannot change without a reload), so the hook order
 * is stable.
 */
import { mockChoice } from '../../../api/provider';
import { usePunchFlowLive } from './flow-live';
import { usePunchFlowStub } from './flow-stub';
import type { PunchFlow } from './flow-types';

const useImpl: () => PunchFlow = mockChoice() ? usePunchFlowStub : usePunchFlowLive;

export function usePunchSheetFlow(): PunchFlow {
  return useImpl();
}
