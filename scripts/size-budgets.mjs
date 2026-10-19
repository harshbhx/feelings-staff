#!/usr/bin/env node
/**
 * Performance budgets (PRD 11.10), run in CI after `pnpm build`:
 * - staff initial JS (entry + its static imports, gzip) <= 170 KB
 * - each owner route chunk (gzip) <= 120 KB (Leaflet/map chunks excluded: lazy)
 * - total CSS (gzip) <= 25 KB
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { ROOT } from './lib.mjs';

const dist = join(ROOT, 'app/dist/client');
const manifestPath = [join(dist, '.vite/manifest.json'), join(dist, 'manifest.json')].find(
  existsSync,
);
if (!manifestPath) {
  console.error('size-budgets: no Vite manifest; run pnpm build first');
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const gz = (file) => gzipSync(readFileSync(join(dist, file))).length;
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

const entryKey = Object.keys(manifest).find((k) => manifest[k].isEntry && k.endsWith('main.tsx'));
const seen = new Set();
function staticClosure(key) {
  if (seen.has(key)) return;
  seen.add(key);
  for (const imp of manifest[key]?.imports ?? []) staticClosure(imp);
}
if (entryKey) staticClosure(entryKey);
let initialJs = 0;
for (const k of seen) if (manifest[k].file.endsWith('.js')) initialJs += gz(manifest[k].file);

const cssFiles = new Set();
for (const v of Object.values(manifest)) for (const c of v.css ?? []) cssFiles.add(c);
let css = 0;
for (const c of cssFiles) css += gz(c);

const problems = [];
const ownerChunks = [];
for (const [k, v] of Object.entries(manifest)) {
  if (!v.file.endsWith('.js') || seen.has(k)) continue;
  const isOwner = k.includes('features/owner') || (v.src ?? '').includes('features/owner');
  const isMap = /leaflet|map/i.test(k) || /leaflet|map/i.test(v.file);
  if (isOwner && !isMap) {
    const size = gz(v.file);
    ownerChunks.push({ chunk: k, size });
    if (size > 120 * 1024) problems.push(`owner chunk ${k} is ${kb(size)} (budget 120 KB)`);
  }
}
if (initialJs > 170 * 1024) problems.push(`staff initial JS is ${kb(initialJs)} (budget 170 KB)`);
if (css > 25 * 1024) problems.push(`CSS is ${kb(css)} (budget 25 KB)`);

const summary = {
  initialJsKb: +(initialJs / 1024).toFixed(1),
  cssKb: +(css / 1024).toFixed(1),
  ownerChunks: ownerChunks.map((c) => ({ chunk: c.chunk, kb: +(c.size / 1024).toFixed(1) })),
};
writeFileSync(join(ROOT, 'app/dist/size-report.json'), JSON.stringify(summary, null, 2));
console.info(
  `size-budgets: staff initial JS ${kb(initialJs)}, CSS ${kb(css)}, ${ownerChunks.length} owner chunk(s)`,
);
if (problems.length) {
  for (const p of problems) console.error(`size-budgets: ${p}`);
  process.exitCode = 1;
}
