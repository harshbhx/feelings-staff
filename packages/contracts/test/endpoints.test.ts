import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { buildPath, ENDPOINT_KEYS, endpoints } from '../src';

describe('endpoint table', () => {
  it('has a unique method + path for every endpoint', () => {
    const seen = new Map<string, string>();
    for (const key of ENDPOINT_KEYS) {
      const e = endpoints[key];
      const id = `${e.method} ${e.path}`;
      expect(seen.get(id), `${key} duplicates ${seen.get(id)}`).toBeUndefined();
      seen.set(id, key);
    }
  });

  it('declares a params schema exactly when the path has :params', () => {
    for (const key of ENDPOINT_KEYS) {
      const e = endpoints[key] as { path: string; params?: z.ZodType };
      const names = [...e.path.matchAll(/:([A-Za-z]+)/g)].map((m) => m[1]).sort();
      if (names.length === 0) {
        expect(e.params, `${key} has params but no :param`).toBeUndefined();
        continue;
      }
      expect(e.params, `${key} needs a params schema`).toBeDefined();
      const shape = (e.params as z.ZodObject).shape as Record<string, unknown>;
      expect(Object.keys(shape).sort(), key).toEqual(names);
    }
  });

  it('only allows bodies on non-GET endpoints and multipart on POST', () => {
    for (const key of ENDPOINT_KEYS) {
      const e = endpoints[key] as { method: string; body?: unknown; multipart?: boolean };
      if (e.method === 'GET') expect(e.body, key).toBeUndefined();
      if (e.multipart) expect(e.method, key).toBe('POST');
    }
  });

  it('requires a permission name only where managers are allowed', () => {
    for (const key of ENDPOINT_KEYS) {
      const e = endpoints[key] as { access: readonly string[]; perm?: string };
      if (e.perm) expect(e.access.includes('manager'), key).toBe(true);
    }
  });

  it('marks every test route as test-only and nothing else', () => {
    for (const key of ENDPOINT_KEYS) {
      const e = endpoints[key];
      expect(e.path.startsWith('/__test/'), key).toBe(
        (e.access as readonly string[]).includes('test'),
      );
    }
  });

  it('builds paths with encoded params', () => {
    expect(buildPath('/owner/days/:userId/:date', { userId: 'A B', date: '2026-10-19' })).toBe(
      '/owner/days/A%20B/2026-10-19',
    );
    expect(() => buildPath('/x/:id', {})).toThrow();
  });
});
