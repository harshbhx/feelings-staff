#!/usr/bin/env node
/**
 * Performance budgets (PRD 11.10), run in CI after `pnpm build`. The build has up to three client
 * outputs (docs/owner-access.md): the combined one at `app/dist/client` (served while OWNER_HOST is
 * unset), the staff split at `_s` and the owner split at `_o` below it. Each is measured on its own:
 * - staff initial JS (entry + its static imports, gzip) <= 170 KB. The combined build keeps the
 *   SIZE_BUDGET_JS_STRICT switch it has today; the staff split is always strict (it has no owner code).
 * - each owner route chunk (gzip) <= 120 KB (Leaflet/map chunks excluded: lazy)
 * - CSS (gzip) <= 25 KB for any route: initial CSS + the lazy route chunk's CSS (map excluded)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { ROOT } from './lib.mjs';

const clientDir = join(ROOT, 'app/dist/client');
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const problems = [];

/** Measure one client output. `strictJs` turns the 170 KB initial JS budget into a failure. */
function measure(label, dist, strictJs) {
  const manifestPath = [join(dist, '.vite/manifest.json'), join(dist, 'manifest.json')].find(
    existsSync,
  );
  if (!manifestPath) {
    console.error(`size-budgets: no Vite manifest for ${label} (${dist}); run pnpm build first`);
    process.exit(1);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const gz = (file) => gzipSync(readFileSync(join(dist, file))).length;

  // The client entry is `index.html` in the manifest (main.tsx is bundled into it); accept both.
  const entryKey = Object.keys(manifest).find(
    (k) => manifest[k].isEntry && (k.endsWith('index.html') || /src\/main[^/]*\.tsx$/.test(k)),
  );
  if (!entryKey) {
    console.error(`size-budgets: no client entry in the ${label} Vite manifest`);
    process.exit(1);
  }

  /** Keys of a chunk and everything it imports statically (what loads together with it). */
  const staticClosure = (key, into = new Set()) => {
    if (into.has(key) || !manifest[key]) return into;
    into.add(key);
    for (const imp of manifest[key].imports ?? []) staticClosure(imp, into);
    return into;
  };
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
      if (size > 120 * 1024)
        problems.push(`${label}: owner chunk ${k} is ${kb(size)} (budget 120 KB)`);
    }
  }
  const allCss = sumGz(cssOf(Object.keys(manifest)));

  // The combined build's staff initial JS stays advisory until SIZE_BUDGET_JS_STRICT is set (CI sets
  // it); the staff split is strict always. The owner split has no staff-phone budget.
  if (label !== 'owner' && initialJs > 170 * 1024) {
    const msg = `${label}: staff initial JS is ${kb(initialJs)} (budget 170 KB)`;
    if (strictJs) problems.push(msg);
    else
      console.info(`::warning title=Size budget::${msg}; not enforced yet (SIZE_BUDGET_JS_STRICT)`);
  }
  if (worstRouteCss.size > 25 * 1024) {
    problems.push(
      `${label}: CSS on ${worstRouteCss.chunk} is ${kb(worstRouteCss.size)} (budget 25 KB)`,
    );
  }

  console.info(
    `size-budgets ${label}: initial JS ${kb(initialJs)}, initial CSS ${kb(initialCss)}, worst route CSS ${kb(worstRouteCss.size)} (${worstRouteCss.chunk}), all CSS ${kb(allCss)}, ${ownerChunks.length} owner chunk(s)`,
  );
  return {
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
}

const jsStrict = process.env.SIZE_BUDGET_JS_STRICT === '1';
const summary = measure('combined', clientDir, jsStrict);
const splitDirs = { staff: join(clientDir, '_s'), owner: join(clientDir, '_o') };
const split = {};
for (const [name, dir] of Object.entries(splitDirs)) {
  if (existsSync(dir)) split[name] = measure(name, dir, true);
  else console.info(`size-budgets: no ${name} split build in ${dir}; skipped`);
}
writeFileSync(
  join(ROOT, 'app/dist/size-report.json'),
  JSON.stringify({ ...summary, split }, null, 2),
);
if (problems.length) {
  for (const p of problems) console.error(`size-budgets: ${p}`);
  process.exitCode = 1;
}
