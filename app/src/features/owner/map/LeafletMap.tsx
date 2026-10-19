/**
 * Leaflet + OpenStreetMap, loaded only when a map is on screen (PRD 11.10: the map is its own lazy
 * chunk). Draws the fence circle, an optional older circle (calibration), the punch pin with its
 * accuracy circle, and lets the owner pick a point when `onPick` is set.
 */
import 'leaflet/dist/leaflet.css';
import './map.css';
import L from 'leaflet';
import { useEffect, useRef } from 'react';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface LeafletMapProps {
  centre: LatLng;
  radiusM?: number | undefined;
  oldCircle?: { centre: LatLng; radiusM: number } | undefined;
  pin?: (LatLng & { accuracyM?: number | null | undefined }) | undefined;
  /** Accessible name of the map region. */
  label: string;
  height?: string | undefined;
  onPick?: ((p: LatLng) => void) | undefined;
}

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

export default function LeafletMap({
  centre,
  radiusM,
  oldCircle,
  pin,
  label,
  height = '14rem',
  onPick,
}: LeafletMapProps) {
  const box = useRef<HTMLDivElement | null>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const pick = useRef(onPick);
  pick.current = onPick;

  useEffect(() => {
    if (!box.current) return;
    const m = L.map(box.current, {
      zoomControl: true,
      attributionControl: true,
      scrollWheelZoom: false,
    });
    // Credit OpenStreetMap only: Leaflet's default prefix adds a flag icon outside the brand.
    m.attributionControl.setPrefix(false);
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) =>
      pick.current?.({ lat: e.latlng.lat, lng: e.latlng.lng }),
    );
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
      layer.current = null;
    };
  }, []);

  // Redraw only when the geometry changes (props are new objects on every render).
  const spec = JSON.stringify({ centre, radiusM, oldCircle, pin });
  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g) return;
    const { centre, radiusM, oldCircle, pin } = JSON.parse(spec) as Pick<
      LeafletMapProps,
      'centre' | 'radiusM' | 'oldCircle' | 'pin'
    >;
    g.clearLayers();
    // Bounds come from the geometry, not from the layers: a circle only knows its bounds once the
    // map has a view, and the first fitBounds below is what gives it one.
    const around = (p: LatLng, r: number) => L.latLng(p.lat, p.lng).toBounds(r * 2);
    const bounds = L.latLngBounds([centre, centre]);
    if (oldCircle) {
      const c = L.circle(oldCircle.centre, {
        radius: oldCircle.radiusM,
        className: 'owner-fence-old',
      });
      g.addLayer(c);
      bounds.extend(around(oldCircle.centre, oldCircle.radiusM));
    }
    if (radiusM) {
      const c = L.circle(centre, { radius: radiusM, className: 'owner-fence', interactive: false });
      g.addLayer(c);
      bounds.extend(around(centre, radiusM));
      g.addLayer(
        L.marker(centre, {
          icon: L.divIcon({
            className: '',
            html: '<span class="owner-centre"></span>',
            iconSize: [8, 8],
          }),
          interactive: false,
          keyboard: false,
        }),
      );
    }
    if (pin) {
      if (pin.accuracyM) {
        const a = L.circle(pin, {
          radius: pin.accuracyM,
          className: 'owner-accuracy',
          interactive: false,
        });
        g.addLayer(a);
        bounds.extend(around(pin, pin.accuracyM));
      }
      g.addLayer(
        L.marker(pin, {
          icon: L.divIcon({
            className: '',
            html: '<span class="owner-pin"></span>',
            iconSize: [14, 14],
          }),
          interactive: false,
          keyboard: false,
        }),
      );
      bounds.extend(pin);
    }
    m.fitBounds(bounds.pad(0.25), { maxZoom: 18, animate: false });
  }, [spec]);

  return (
    <section className="owner-map" aria-label={label}>
      <div ref={box} style={{ height }} />
    </section>
  );
}
