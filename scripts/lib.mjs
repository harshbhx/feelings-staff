/** Small helpers shared by the check scripts (no dependencies). */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export const ROOT = new URL('..', import.meta.url).pathname;

const SKIP = new Set([
  'node_modules',
  'dist',
  'coverage',
  '.wrangler',
  'playwright-report',
  'test-results',
  '.git',
]);

/** Recursively list files under `dir` (relative to repo root) matching `exts`. */
export function walk(dir, exts) {
  const out = [];
  const abs = join(ROOT, dir);
  let entries;
  try {
    entries = readdirSync(abs);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (SKIP.has(name)) continue;
    const p = join(abs, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(relative(ROOT, p), exts));
    else if (exts.some((e) => name.endsWith(e))) out.push(relative(ROOT, p));
  }
  return out;
}

export const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

export function report(name, problems) {
  if (problems.length === 0) {
    console.info(`${name}: ok`);
    return;
  }
  for (const p of problems) console.error(`${name}: ${p}`);
  console.error(`${name}: ${problems.length} problem(s)`);
  process.exitCode = 1;
}
