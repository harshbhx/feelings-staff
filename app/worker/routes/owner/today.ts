/** Owner today handlers. Owner: WP-4. */
import type { Handlers } from '../../lib/api';
import { todayBoard } from '../../services/board';

export const handlers: Handlers = {
  async ownerToday(_input, ctx) {
    return todayBoard(ctx);
  },
};
