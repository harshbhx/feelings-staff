import type { FenceCheck, Fix, SiteGeo } from '@fs/contracts';
import { EngineNotReady } from '../version';

/** Great-circle distance in metres. Owner: WP-4. */
export function haversineM(
  _a: { lat: number; lng: number },
  _b: { lat: number; lng: number },
): number {
  throw new EngineNotReady('haversineM');
}

/** PASS / UNCERTAIN / OUTSIDE / APPROXIMATE (PRD 4.4.1). Owner: WP-4. */
export function fenceCheck(_fix: Fix, _site: SiteGeo): FenceCheck {
  throw new EngineNotReady('fenceCheck');
}
