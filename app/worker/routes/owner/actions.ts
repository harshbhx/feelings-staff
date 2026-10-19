/** Owner approvals: the Needs-action queue and every decision on it (PRD 4.12). Owner: WP-4. */
import type { Handlers } from '../../lib/api';
import { adjustLeave, decideLeave, staffLeaveView } from '../../services/leave';
import {
  bulkDecide,
  decideAutoClose,
  decideOffsite,
  decideOvertime,
  listActions,
  reviewPunch,
} from '../../services/owner-actions';
import { ownerDayDetail } from '../../services/owner-days';
import { decideRegularisation } from '../../services/regularisation';

export const handlers: Handlers = {
  async ownerActions({ query }, ctx) {
    return listActions(ctx, query.type);
  },

  async ownerActionsBulk({ body }, ctx) {
    return bulkDecide(ctx, body);
  },

  async ownerPunchReview({ params, body }, ctx) {
    return reviewPunch(ctx, params.id, body);
  },

  async ownerLeaveDecide({ params, body }, ctx) {
    return decideLeave(ctx, params.id, body);
  },

  async ownerRegularisationDecide({ params, body }, ctx) {
    return decideRegularisation(ctx, params.id, body);
  },

  async ownerOvertimeDecide({ params, body }, ctx) {
    return decideOvertime(ctx, params.userId, params.date, body);
  },

  async ownerAutoCloseDecide({ params, body }, ctx) {
    await decideAutoClose(ctx, params.userId, params.date, body);
    return ownerDayDetail(ctx, params.userId, params.date);
  },

  async ownerOffsiteDecide({ params, body }, ctx) {
    return decideOffsite(ctx, params.punchId, body);
  },

  async ownerStaffLeave({ params }, ctx) {
    return staffLeaveView(ctx, params.id);
  },

  async ownerStaffLeaveAdjust({ params, body }, ctx) {
    return adjustLeave(ctx, params.id, body);
  },
};
