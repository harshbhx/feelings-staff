import { ENDPOINT_KEYS, type EndpointShape, endpoints } from '@fs/contracts';
import { describe, expect, it } from 'vitest';
import { type ClientRoute, OWNER_ACCESS_ROUTES, ROUTES } from './routes.gen';

describe('client route table', () => {
  // Unit tests run as the combined build, so ROUTES has every route except the owner-access ones.
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

  it('leaves the owner-host passkey routes out of builds other than the owner build', () => {
    const owner = Object.keys(OWNER_ACCESS_ROUTES);
    expect(owner.length).toBeGreaterThan(0);
    for (const key of owner) {
      expect(key in ROUTES, key).toBe(false);
      expect(endpoints[key as keyof typeof endpoints].path).toMatch(/^\/(auth\/owner|owner)\//);
    }
  });
});
