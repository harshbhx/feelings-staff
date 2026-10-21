import { ENDPOINT_KEYS, type EndpointShape, endpoints } from '@fs/contracts';
import { describe, expect, it } from 'vitest';
import { type ClientRoute, OWNER_ACCESS_ROUTES, ROUTES } from './routes.gen';

describe('client route table', () => {
  const ownerKeys = Object.keys(OWNER_ACCESS_ROUTES).sort();
  const all: Partial<Record<string, ClientRoute>> = { ...ROUTES, ...OWNER_ACCESS_ROUTES };

  it('matches the contract endpoint table (run node scripts/gen-client-routes.mjs)', () => {
    expect(Object.keys(all).sort()).toEqual([...ENDPOINT_KEYS].sort());
    for (const key of ENDPOINT_KEYS) {
      const def = endpoints[key] as EndpointShape;
      const r = all[key] as ClientRoute;
      expect({ key, m: r.m, p: r.p, i: !!r.i, mp: !!r.mp, b: !!r.b, s: r.s ?? 200 }).toEqual({
        key,
        m: def.method,
        p: def.path,
        i: !!def.idempotent,
        mp: !!def.multipart,
        b: !!def.binary,
        s: def.status ?? 200,
      });
    }
  });

  // Unit tests run as the combined build: ROUTES (what the HTTP client calls) has every route but
  // the owner-host passkey ones, which only the owner build merges in.
  it('ROUTES holds exactly the routes that are not owner access in this build', () => {
    expect(ownerKeys.length).toBeGreaterThan(0);
    const expected = ENDPOINT_KEYS.filter((k) => !ownerKeys.includes(k)).sort();
    expect(Object.keys(ROUTES).sort()).toEqual(expected);
    for (const key of ownerKeys)
      expect(endpoints[key as keyof typeof endpoints].path, key).toMatch(
        /^\/(auth\/owner|owner)\//,
      );
  });
});
