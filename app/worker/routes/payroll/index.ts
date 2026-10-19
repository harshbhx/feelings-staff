/**
 * Route handlers. Owner: WP-5: advances, payroll runs, payslips, payslip verify (exports follow in
 * their own change). Each handler is thin: the services own the rules and the audit rows.
 */
import type { Handlers } from '../../lib/api';
import {
  ackAdvance,
  cancelAdvance,
  createAdvance,
  decideAdvance,
  getAdvance,
  listAdvances,
  myAdvances,
  patchAdvance,
  requestAdvance,
} from '../../services/advance';
import {
  addAdjustment,
  deleteAdjustment,
  draftForMonth,
  finaliseRun,
  listRuns,
  loadRun,
  markAllPaid,
  markPaid,
  patchRecovery,
  personView,
  previewView,
  recomputeRun,
  reopenRun,
  runView,
} from '../../services/payroll';
import { myPayslip, myPayslips, payslipPdf, verifyPayslip } from '../../services/payslip';

export const handlers: Handlers = {
  // Staff
  meAdvances: (_i, ctx) => myAdvances(ctx),
  advanceRequestCreate: ({ body }, ctx) => requestAdvance(ctx, body),
  advanceAck: ({ params, body }, ctx) => ackAdvance(ctx, params.id, body),
  mePayslips: (_i, ctx) => myPayslips(ctx),
  mePayslip: ({ params }, ctx) => myPayslip(ctx, params.id),
  payslipPdf: ({ params }, ctx) => payslipPdf(ctx, params.id),

  // Owner: advances
  ownerAdvancesList: ({ query }, ctx) => listAdvances(ctx, query),
  ownerAdvanceCreate: ({ body }, ctx) => createAdvance(ctx, body),
  ownerAdvanceGet: ({ params }, ctx) => getAdvance(ctx, params.id),
  ownerAdvancePatch: ({ params, body }, ctx) => patchAdvance(ctx, params.id, body),
  ownerAdvanceCancel: async ({ params }, ctx) => {
    await cancelAdvance(ctx, params.id);
    return undefined;
  },
  ownerAdvanceDecide: ({ params, body }, ctx) => decideAdvance(ctx, params.id, body),

  // Owner: payroll runs
  ownerPayrollRuns: (_i, ctx) => listRuns(ctx),
  ownerPayrollCreate: ({ body }, ctx) => draftForMonth(ctx, body.month),
  ownerPayrollPreview: ({ query }, ctx) => previewView(ctx, query.month),
  ownerPayrollGet: async ({ params }, ctx) => runView(ctx, await loadRun(ctx, params.id)),
  ownerPayrollRecompute: ({ params }, ctx) => recomputeRun(ctx, params.id),
  ownerPayslipPreview: async ({ params }, ctx) =>
    personView(ctx, await loadRun(ctx, params.id), params.userId),
  ownerAdjustmentAdd: ({ params, body }, ctx) => addAdjustment(ctx, params.id, body),
  ownerAdjustmentDelete: ({ params }, ctx) => deleteAdjustment(ctx, params.id, params.adjId),
  ownerAdvanceRecovery: ({ params, body }, ctx) => patchRecovery(ctx, params.id, body),
  ownerPayrollFinalise: ({ params, body }, ctx) => finaliseRun(ctx, params.id, body.acceptDefaults),
  ownerPayrollReopen: ({ params, body }, ctx) => reopenRun(ctx, params.id, body),
  ownerPayslipMarkPaid: ({ params, body }, ctx) => markPaid(ctx, params.id, body),
  ownerPayrollMarkAllPaid: ({ params, body }, ctx) => markAllPaid(ctx, params.id, body),

  // Public
  verifyPayslip: ({ params }, ctx) => verifyPayslip(ctx, params.token),
};
