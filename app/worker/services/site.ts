/** Site views shared by the owner screens (PRD 4.4.1, 4.15.2). Owner: WP-4. */
import type { SiteView } from '@fs/contracts';
import type { SiteRow } from './door';

export function siteView(s: SiteRow): SiteView {
  return {
    id: s.id,
    kind: s.kind,
    name: s.name,
    lat: s.lat,
    lng: s.lng,
    radiusM: s.radius_m,
    maxAccuracyM: s.max_accuracy_m,
    active: s.active === 1,
    validFrom: s.valid_from,
    validTo: s.valid_to,
  };
}
