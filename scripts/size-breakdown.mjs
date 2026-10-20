#!/usr/bin/env node
/**
 * Diagnostic: which packages and source folders make up the staff initial chunks (raw bytes from
 * source maps). Needs a build made with SIZE_ANALYZE=1 (hidden source maps). Never fails the build.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { ROOT } from './lib.mjs';

const dist = join(ROOT, 'app/dist/client');
const manifestPath = join(dist, '.vite/manifest.json');
if (!existsSync(manifestPath)) process.exit(0);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const entry = Object.keys(manifest).find((k) => manifest[k].isEntry && k.endsWith('index.html'));
const seen = new Set();
const walk = (k) => {
  if (seen.has(k) || !manifest[k]) return;
  seen.add(k);
  for (const i of manifest[k].imports ?? []) walk(i);
};
walk(entry);

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function decode(s) {
  const out = [];
  let v = 0;
  let sh = 0;
  for (const c of s) {
    const d = B64.indexOf(c);
    v += (d & 31) << sh;
    if (d & 32) sh += 5;
    else {
      out.push(v & 1 ? -(v >> 1) : v >> 1);
      v = 0;
      sh = 0;
    }
  }
  return out;
}
const sizes = new Map();
const texts = new Map();
for (const k of seen) {
  const file = join(dist, manifest[k].file);
  if (!existsSync(`${file}.map`)) {
    console.info(`size-breakdown: no source map for ${manifest[k].file}`);
    continue;
  }
  const sm = JSON.parse(readFileSync(`${file}.map`, 'utf8'));
  const lines = readFileSync(file, 'utf8').split('\n');
  let src = 0;
  sm.mappings.split(';').forEach((line, ln) => {
    let col = 0;
    const segs = [];
    for (const s of line.split(',')) {
      if (!s) continue;
      const d = decode(s);
      col += d[0];
      if (d.length >= 4) {
        src += d[1];
        segs.push([col, src]);
      }
    }
    const len = (lines[ln] ?? '').length;
    segs.forEach(([c, si], i) => {
      const end = i + 1 < segs.length ? segs[i + 1][0] : len;
      const name = sm.sources[si];
      const m = name.match(/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)/);
      const key = m
        ? m[1]
        : name
            .replace(/^(\.\.\/)+/, '')
            .split('/')
            .slice(0, 5)
            .join('/');
      sizes.set(key, (sizes.get(key) ?? 0) + Math.max(0, end - c));
      texts.set(key, `${texts.get(key) ?? ''}${(lines[ln] ?? '').slice(c, end)}`);
    });
  });
}
const gzOf = (k) => gzipSync(texts.get(k) ?? '').length;
const rows = [...sizes].sort((a, b) => gzOf(b[0]) - gzOf(a[0])).slice(0, 45);
console.info(
  'size-breakdown: raw KB and own-gzip KB per package/folder in the staff initial chunks',
);
for (const [k, n] of rows)
  console.info(
    `  ${(n / 1024).toFixed(1).padStart(7)} raw ${(gzOf(k) / 1024).toFixed(1).padStart(6)} gz  ${k}`,
  );
