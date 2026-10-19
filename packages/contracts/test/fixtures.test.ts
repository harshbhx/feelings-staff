import { describe, expect, it } from 'vitest';
import { fixtures, variants } from '../fixtures';
import { ENDPOINT_KEYS, type EndpointKey, endpoints } from '../src';
import type { EndpointShape } from '../src/endpoint';

const def = (key: EndpointKey) => endpoints[key] as EndpointShape;

/** Endpoints whose response is a JSON body (not a file, not an empty 2xx). */
const jsonKeys = ENDPOINT_KEYS.filter((key) => {
  const d = def(key);
  return !d.binary && !d.res.safeParse(undefined).success;
});

const cases: { file: string; key: EndpointKey; value: unknown }[] = [];
for (const key of ENDPOINT_KEYS) {
  if (key in fixtures) cases.push({ file: `${key}.json`, key, value: fixtures[key] });
  for (const [name, value] of Object.entries(variants[key] ?? {}))
    cases.push({ file: `${key}.${name}.json`, key, value });
}

function check(key: EndpointKey, file: string, value: unknown) {
  const result = def(key).res.safeParse(value);
  expect(
    result.success,
    `${file} does not match the ${key} response schema:\n${JSON.stringify(result.error?.issues, null, 2)}`,
  ).toBe(true);
  // Parsing strips unknown keys, so equality also catches misspelled or extra fields.
  expect(result.data, `${file} has fields the schema does not know`).toEqual(value);
}

describe('fixtures', () => {
  it('has a default fixture for every JSON-response endpoint', () => {
    const missing = jsonKeys.filter((key) => fixtures[key] === undefined);
    expect(missing, `endpoints without a fixture: ${missing.join(', ')}`).toEqual([]);
  });

  it('has no fixture for an endpoint that returns a file or no body', () => {
    const extra = Object.keys(fixtures).filter((key) => !jsonKeys.includes(key as EndpointKey));
    expect(extra).toEqual([]);
  });

  it('only names endpoints that exist', () => {
    const known = new Set<string>(ENDPOINT_KEYS);
    expect(Object.keys(fixtures).filter((k) => !known.has(k))).toEqual([]);
    expect(Object.keys(variants).filter((k) => !known.has(k))).toEqual([]);
  });

  it('has the variants the UI states need', () => {
    const need: Partial<Record<EndpointKey, string[]>> = {
      meToday: ['checked-in', 'checked-out', 'week-off', 'on-leave', 'pending-proof'],
      punchCreate: ['flagged', 'needs-proof', 'pending'],
      ownerToday: ['before-first-shift', 'holiday'],
      ownerActions: ['empty'],
      ownerPayrollGet: ['finalised', 'with-blockers'],
      mePayslips: ['empty'],
      notificationsList: ['empty'],
      me: ['owner', 'staff-pending-device'],
    };
    for (const [key, names] of Object.entries(need)) {
      for (const name of names) {
        expect(variants[key as EndpointKey]?.[name], `${key}.${name}.json`).toBeDefined();
      }
    }
  });

  describe.each(cases)('$file', ({ file, key, value }) => {
    it('matches its response schema', () => {
      check(key, file, value);
    });
  });

  it('shows one name and phone per person id in every file', () => {
    const seen = new Map<string, { name: string; phone: unknown; file: string }>();
    const problems: string[] = [];
    const walk = (node: unknown, file: string) => {
      if (Array.isArray(node)) {
        for (const item of node) walk(item, file);
        return;
      }
      if (node === null || typeof node !== 'object') return;
      const o = node as Record<string, unknown>;
      if (typeof o.id === 'string' && typeof o.name === 'string' && 'phone' in o) {
        const prev = seen.get(o.id);
        if (!prev) seen.set(o.id, { name: o.name, phone: o.phone, file });
        else if (prev.name !== o.name || prev.phone !== o.phone)
          problems.push(`${o.id}: ${prev.name} in ${prev.file}, ${o.name} in ${file}`);
      }
      for (const v of Object.values(o)) walk(v, file);
    };
    for (const c of cases) walk(c.value, c.file);
    expect(problems).toEqual([]);
    expect(seen.size).toBeGreaterThanOrEqual(12);
  });

  it('keeps the salon voice: no exclamation marks in copy', () => {
    const bad = cases.filter((c) => JSON.stringify(c.value).includes('!')).map((c) => c.file);
    expect(bad).toEqual([]);
  });
});
