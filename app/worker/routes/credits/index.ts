/**
 * Time credits routes (WP-9, PRD 9.4). Owner only, all of them: the endpoint table gives managers and
 * staff no access, and nothing here is reachable from a staff screen. Handlers are thin; the services
 * own the rules and the audit rows.
 */
import type { Handlers } from '../../lib/api';
import {
  createAdjustment,
  creditLedger,
  creditsOverview,
  patchAdjustment,
  setSettlement,
  settleView,
  voidAdjustment,
} from '../../services/credits';

export const handlers: Handlers = {
  ownerCredits: ({ query }, ctx) => creditsOverview(ctx, query),
  ownerCreditLedger: ({ params, query }, ctx) => creditLedger(ctx, params.userId, query),
  ownerCreditAdjustmentCreate: ({ params, body }, ctx) =>
    createAdjustment(ctx, params.userId, body),
  ownerCreditAdjustmentPatch: ({ params, body }, ctx) => patchAdjustment(ctx, params.id, body),
  ownerCreditAdjustmentVoid: ({ params, body }, ctx) => voidAdjustment(ctx, params.id, body),
  ownerPayrollCredits: ({ params }, ctx) => settleView(ctx, params.id),
  ownerPayrollCreditSet: ({ params, body }, ctx) =>
    setSettlement(ctx, params.id, params.userId, body),
};
