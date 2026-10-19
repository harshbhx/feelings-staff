/** Owner off-site duties and the Google Maps link reader (PRD 4.6). Owner: WP-4. */
import type { Handlers } from '../../lib/api';
import {
  cancelDuty,
  createDuty,
  getDuty,
  listDuties,
  patchDuty,
} from '../../services/owner-config';

export const handlers: Handlers = {
  async ownerDutiesList({ query }, ctx) {
    return listDuties(ctx, query.from, query.to);
  },
  async ownerDutyCreate({ body }, ctx) {
    return createDuty(ctx, body);
  },
  async ownerDutyGet({ params }, ctx) {
    return getDuty(ctx, params.id);
  },
  async ownerDutyPatch({ params, body }, ctx) {
    return patchDuty(ctx, params.id, body);
  },
  async ownerDutyCancel({ params }, ctx) {
    await cancelDuty(ctx, params.id);
    return undefined;
  },
  async ownerMapsResolve({ body }, ctx) {
    return ctx.services.maps.resolve(body.url);
  },
};
