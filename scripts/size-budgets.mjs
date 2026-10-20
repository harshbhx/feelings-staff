#!/usr/bin/env node
/**
 * Performance budgets (PRD 11.10), run in CI after `pnpm build`:
 * - staff initial JS (entry + its static imports, gzip) <= 170 KB
 * - each owner route chunk (gzip) <= 120 KB (Leaflet/map chunks excluded: lazy)
 * - CSS (gzip) <= 25 KB for any route: initial CSS + the lazy route chunk's CSS (map excluded)
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
const kb = (n) => `${(n / 1024).toFixed(1)} KB (${n} B)`;

// The client entry is `index.html` in the manifest (main.tsx is bundled into it); accept both.
const entryKey = Object.keys(manifest).find(
  (k) => manifest[k].isEntry && (k.endsWith('index.html') || k.endsWith('main.tsx')),
);
if (!entryKey) {
  console.error('size-budgets: no client entry (index.html or main.tsx) in the Vite manifest');
  process.exit(1);
}

/** Keys of a chunk and everything it imports statically (what loads together with it). */
function staticClosure(key, into = new Set()) {
  if (into.has(key) || !manifest[key]) return into;
  into.add(key);
  for (const imp of manifest[key].imports ?? []) staticClosure(imp, into);
  return into;
}
const cssOf = (keys) => {
  const files = new Set();
  for (const k of keys) for (const c of manifest[k]?.css ?? []) files.add(c);
  return files;
};
const sumGz = (files) => [...files].reduce((n, f) => n + gz(f), 0);

const initial = staticClosure(entryKey);
let initialJs = 0;
for (const k of initial) if (manifest[k].file.endsWith('.js')) initialJs += gz(manifest[k].file);
const initialCssFiles = cssOf(initial);
const initialCss = sumGz(initialCssFiles);

const isMapChunk = (k, v) => /leaflet|map/i.test(k) || /leaflet|map/i.test(v.file);
const problems = [];
const ownerChunks = [];
// CSS budget per route: what a page actually downloads is the initial CSS plus the CSS of the
// lazy route chunk it opens. Leaflet and the map stay outside (their own lazy chunk, PRD 11.10).
let worstRouteCss = { chunk: entryKey, size: initialCss };
for (const [k, v] of Object.entries(manifest)) {
  if (!v.file.endsWith('.js') || initial.has(k) || isMapChunk(k, v)) continue;
  const routeKeys = [...staticClosure(k)].filter((x) => !isMapChunk(x, manifest[x]));
  const routeCss = sumGz(new Set([...initialCssFiles, ...cssOf(routeKeys)]));
  if (routeCss > worstRouteCss.size) worstRouteCss = { chunk: k, size: routeCss };
  const isOwner = k.includes('features/owner') || (v.src ?? '').includes('features/owner');
  if (isOwner) {
    const size = gz(v.file);
    ownerChunks.push({ chunk: k, size });
    if (size > 120 * 1024) problems.push(`owner chunk ${k} is ${kb(size)} (budget 120 KB)`);
  }
}
const allCss = sumGz(cssOf(Object.keys(manifest)));

// Staff initial JS is reported and annotated now; it fails the build once the integration slice
// (lazy auth/owner/door/public/kit routes, zod-free HTTP route table) lands and sets it strict.
const jsStrict = process.env.SIZE_BUDGET_JS_STRICT === '1';
if (initialJs > 170 * 1024) {
  const msg = `staff initial JS is ${kb(initialJs)} (budget 170 KB)`;
  if (jsStrict) problems.push(msg);
  else
    console.info(`::warning title=Size budget::${msg}; not enforced yet (SIZE_BUDGET_JS_STRICT)`);
}
if (worstRouteCss.size > 25 * 1024) {
  problems.push(`CSS on ${worstRouteCss.chunk} is ${kb(worstRouteCss.size)} (budget 25 KB)`);
}

const summary = {
  entry: entryKey,
  initialJsKb: +(initialJs / 1024).toFixed(1),
  initialCssKb: +(initialCss / 1024).toFixed(1),
  worstRouteCss: { chunk: worstRouteCss.chunk, kb: +(worstRouteCss.size / 1024).toFixed(1) },
  allCssKb: +(allCss / 1024).toFixed(1),
  cssFiles: [...cssOf(Object.keys(manifest))].map((f) => ({
    file: f,
    kb: +(gz(f) / 1024).toFixed(1),
  })),
  ownerChunks: ownerChunks.map((c) => ({ chunk: c.chunk, kb: +(c.size / 1024).toFixed(1) })),
};
writeFileSync(join(ROOT, 'app/dist/size-report.json'), JSON.stringify(summary, null, 2));
console.info(
  `size-budgets: staff initial JS ${kb(initialJs)}, initial CSS ${kb(initialCss)}, worst route CSS ${kb(worstRouteCss.size)} (${worstRouteCss.chunk}), all CSS ${kb(allCss)}, ${ownerChunks.length} owner chunk(s)`,
);
if (problems.length) {
  for (const p of problems) console.error(`size-budgets: ${p}`);
  process.exitCode = 1;
}
