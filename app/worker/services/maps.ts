/**
 * Google Maps link resolver (PRD 4.6 A step 3). Owner: WP-4.
 *
 * Only Google hosts are ever contacted, at most 3 redirects are followed, and the coordinates are
 * read from `@lat,lng`, `!3dLAT!4dLNG`, `q=lat,lng` or `ll=lat,lng`.
 */
import { fail } from '../lib/errors';
import type { MapsResolver } from './ports';

const UNREADABLE = "We couldn't read a location from that link. Pick it on the map instead.";
const MAX_HOPS = 3;

/** Hosts we may open: Google Maps and its short-link domains. */
export function isGoogleHost(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h === 'maps.app.goo.gl' ||
    h === 'goo.gl' ||
    h === 'maps.google.com' ||
    /^(www\.)?google\.[a-z.]{2,6}$/.test(h)
  );
}

function pair(lat: string | undefined, lng: string | undefined) {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  if (Math.abs(la) > 90 || Math.abs(ln) > 180) return null;
  return { lat: Math.round(la * 1e6) / 1e6, lng: Math.round(ln * 1e6) / 1e6 };
}

const NUM = '(-?\\d{1,3}\\.\\d+)';

/** Coordinates (and a place label, when the path has one) from a full Google Maps URL. */
export function parseMapsUrl(raw: string): { lat: number; lng: number; label?: string } | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const full = decodeURIComponent(url.pathname + url.search + url.hash);
  const patterns = [
    new RegExp(`!3d${NUM}!4d${NUM}`),
    new RegExp(`@${NUM},${NUM}`),
    new RegExp(`[?&](?:q|ll|query|destination)=${NUM},\\s*${NUM}`),
  ];
  for (const re of patterns) {
    const m = full.match(re);
    const found = m ? pair(m[1], m[2]) : null;
    if (found) {
      const place = url.pathname.match(/\/place\/([^/@]+)/);
      const label = place?.[1]?.replace(/\+/g, ' ');
      return label ? { ...found, label } : found;
    }
  }
  return null;
}

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export function createMapsResolver(fetcher: Fetcher = (u, i) => fetch(u, i)): MapsResolver {
  return {
    async resolve(input) {
      let current: URL;
      try {
        current = new URL(input);
      } catch {
        return fail('VALIDATION', UNREADABLE, { field: 'url' });
      }
      for (let hop = 0; hop <= MAX_HOPS; hop += 1) {
        if (current.protocol !== 'https:' || !isGoogleHost(current.hostname)) {
          return fail('VALIDATION', UNREADABLE, { field: 'url' });
        }
        const direct = parseMapsUrl(current.toString());
        if (direct) return direct;
        if (hop === MAX_HOPS) break;
        let res: Response;
        try {
          res = await fetcher(current.toString(), { method: 'GET', redirect: 'manual' });
        } catch {
          return fail('VALIDATION', UNREADABLE, { field: 'url' });
        }
        const next = res.headers.get('location');
        if (!next) break;
        try {
          current = new URL(next, current);
        } catch {
          break;
        }
      }
      return fail('VALIDATION', UNREADABLE, { field: 'url' });
    },
  };
}
