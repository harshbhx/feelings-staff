import { beforeAll, describe, expect, it } from 'vitest';
import { ENDPOINT_KEYS, endpoints } from '../src';

const API_DOC = new URL('../../../docs/api.md', import.meta.url);

/**
 * This package compiles with `types: []` (no Node typings), so `node:fs` is loaded through a
 * non-literal dynamic import and given the one signature used here. Vitest runs in Node.
 */
async function readApiDoc(): Promise<string> {
  const specifier: string = 'node:fs';
  const fs = (await import(/* @vite-ignore */ specifier)) as {
    readFileSync(path: URL, encoding: 'utf8'): string;
  };
  return fs.readFileSync(API_DOC, 'utf8');
}

/** Pairs of "METHOD /path" found in the first two cells of every table row of docs/api.md. */
function documentedEndpoints(markdown: string): Set<string> {
  const found = new Set<string>();
  for (const line of markdown.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    const method = cells[0];
    const path = cells[1]?.replace(/^`|`$/g, '');
    if (method && path?.startsWith('/')) found.add(`${method} ${path}`);
  }
  return found;
}

describe('docs/api.md', () => {
  let documented = new Set<string>();
  beforeAll(async () => {
    documented = documentedEndpoints(await readApiDoc());
  });

  it('lists every endpoint of the table (method and path)', () => {
    const missing = ENDPOINT_KEYS.map(
      (key) => `${endpoints[key].method} ${endpoints[key].path}`,
    ).filter((id) => !documented.has(id));
    expect(missing, `Add these to docs/api.md: ${missing.join(', ')}`).toEqual([]);
  });

  it('does not list endpoints that are not in the table', () => {
    const known = new Set(
      ENDPOINT_KEYS.map((key) => `${endpoints[key].method} ${endpoints[key].path}`),
    );
    const stale = [...documented].filter((id) => !known.has(id));
    expect(stale, `Remove these from docs/api.md: ${stale.join(', ')}`).toEqual([]);
  });
});
