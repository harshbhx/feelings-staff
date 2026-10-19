import { ENDPOINT_KEYS, type EndpointShape, endpoints } from '@fs/contracts';
import { describe, expect, it } from 'vitest';
import { ROUTES } from './routes.gen';

describe('client route table', () => {
  it('matches the contract endpoint table (run node scripts/gen-client-routes.mjs)', () => {
    expect(Object.keys(ROUTES).sort()).toEqual([...ENDPOINT_KEYS].sort());
    for (const key of ENDPOINT_KEYS) {
      const def = endpoints[key] as EndpointShape;
      const r = ROUTES[key];
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
});
