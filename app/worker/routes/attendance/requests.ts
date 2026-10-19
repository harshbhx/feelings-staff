/** Staff requests: leave and fixes (PRD 4.9, 4.11, 9.4). */
import { addDays, istDate } from '@fs/contracts';
import type { Handlers } from '../../lib/api';
import { fail } from '../../lib/errors';
import { cancelLeave, createLeave, myLeave, previewLeave } from '../../services/leave';
import {
  cancelRegularisation,
  createRegularisation,
  regularisationViews,
} from '../../services/regularisation';

export const handlers: Handlers = {
  async meLeave(_input, ctx) {
    return myLeave(ctx);
  },

  async leavePreview({ body }, ctx) {
    const user = ctx.user ?? fail('UNAUTHENTICATED');
    return (await previewLeave(ctx, user.id, body)).preview;
  },

  async leaveCreate({ body }, ctx) {
    return createLeave(ctx, body);
  },

  async leaveCancel({ params }, ctx) {
    return cancelLeave(ctx, params.id);
  },

  async meRegularisations(_input, ctx) {
    const user = ctx.user ?? fail('UNAUTHENTICATED');
    return regularisationViews(
      ctx,
      'r.user_id = ? AND r.work_date >= ?',
      user.id,
      addDays(istDate(ctx.now()), -120),
    );
  },

  async regularisationCreate({ body }, ctx) {
    return createRegularisation(ctx, body);
  },

  async regularisationCancel({ params }, ctx) {
    return cancelRegularisation(ctx, params.id);
  },
};
