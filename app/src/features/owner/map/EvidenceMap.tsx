/** Lazy wrapper: the Leaflet chunk loads only when a map is shown (PRD 11.10). */
import { Skeleton } from '@fs/ui';
import { lazy, Suspense } from 'react';
import type { LeafletMapProps } from './LeafletMap';

const LeafletMap = lazy(() => import('./LeafletMap'));

export type { LatLng } from './LeafletMap';

export function EvidenceMap(props: LeafletMapProps) {
  return (
    <Suspense fallback={<Skeleton shape="block" height={props.height ?? '14rem'} />}>
      <LeafletMap {...props} />
    </Suspense>
  );
}
