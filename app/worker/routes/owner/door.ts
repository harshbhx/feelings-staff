/** Owner door endpoints: "Show door code" now; device management follows in the roster/site part. */
import type { Handlers } from '../../lib/api';
import { ownerDoorCode } from '../../services/door';

export const handlers: Handlers = {
  async ownerDoorCode(_input, ctx, c) {
    return ownerDoorCode(ctx, ctx.now(), new URL(c.req.url).origin);
  },
};
