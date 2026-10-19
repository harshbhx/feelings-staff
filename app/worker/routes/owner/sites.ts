/** Owner sites and calibration (PRD 4.15.2). Owner: WP-4. */
import type { Handlers } from '../../lib/api';
import { listSites, patchSite, proposeSite, storeCalibration } from '../../services/owner-config';

export const handlers: Handlers = {
  async ownerSites(_input, ctx) {
    return listSites(ctx);
  },
  async ownerSitePatch({ params, body }, ctx) {
    return patchSite(ctx, params.id, body);
  },
  async ownerCalibrationSamples({ params, body }, ctx) {
    return storeCalibration(ctx, params.id, body);
  },
  async ownerCalibrationPropose({ params }, ctx) {
    return proposeSite(ctx, params.id);
  },
};
