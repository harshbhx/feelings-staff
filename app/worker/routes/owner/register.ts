/** Owner register: the month grid (PRD 5.2). Owner: WP-4. */
import type { Handlers } from '../../lib/api';
import { registerView } from '../../services/owner-days';

export const handlers: Handlers = {
  async ownerRegister({ query }, ctx) {
    return registerView(ctx, query.month, query.userId);
  },
};
