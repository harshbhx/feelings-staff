#!/usr/bin/env node
/**
 * The staff build must contain no owner code (docs/owner-access.md, ADR-19). Run in CI after
 * `pnpm build`: greps the staff split output (`app/dist/client/_s`) for owner markers and fails on a hit.
 *
 *   node scripts/check-staff-bundle.mjs                 scan the staff output, fail on any marker
 *   node scripts/check-staff-bundle.mjs --expect-hits   scan the combined output at the asset root
 *                                                       (split folders skipped); fail if NO marker is
 *                                                       found there, which proves the check can see owner code
 *
 * Markers: file names containing "owner" or named like an owner-only screen (derived from
 * app/src/features/owner), route tables and shells, `/o` paths, `auth/owner`, the owner i18n namespace
 * (`t('owner:...')`, owner catalog files) and owner source paths.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';
import { ROOT } from './lib.mjs';

const expectHits = process.argv.includes('--expect-hits');
const clientDir = join(ROOT, 'app/dist/client');
const dir = expectHits ? clientDir : join(clientDir, '_s');
if (!existsSync(dir)) {
  console.error(`check-staff-bundle: ${relative(ROOT, dir)} not found; run pnpm build first`);
  process.exit(1);
}

const TEXT = new Set([
  '.js',
  '.mjs',
  '.css',
  '.html',
  '.json',
  '.webmanifest',
  '.svg',
  '.map',
  '.txt',
]);

/** All files below `root`; in combined mode the split folders are not part of the scan. */
function files(root, skipSplit) {
  const out = [];
  for (const e of readdirSync(root, { withFileTypes: true })) {
    const p = join(root, e.name);
    if (e.isDirectory()) {
      if (skipSplit && root === clientDir && (e.name === '_s' || e.name === '_o')) continue;
      out.push(...files(p, skipSplit));
    } else out.push(p);
  }
  return out;
}

/** Base names of modules in features/owner that no other feature has (their chunks are owner-only). */
function ownerOnlyNames() {
  const walk = (d) =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)],
    );
  const names = (list) =>
    new Set(
      list
        .filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f))
        .map((f) => basename(f).replace(/\.tsx?$/, '')),
    );
  const src = join(ROOT, 'app/src');
  const owner = walk(join(src, 'features/owner'));
  const rest = walk(src).filter((f) => !f.includes('/features/owner/'));
  const others = names(rest);
  // A module named like a folder elsewhere (features/staff/presence) is not owner-only either.
  for (const f of rest) for (const part of f.split('/')) others.add(part.replace(/\.tsx?$/, ''));
  // Generic names (index, routes, ...) are shared by many chunks; only distinctive ones count.
  return [...names(owner)].filter((n) => !others.has(n) && n.length >= 8);
}

const CONTENT = [
  ['owner shell', /OwnerShell|OwnerOnly\b/],
  ['owner route table', /ownerRoutes|ownerAuthRoutes/],
  ['owner sign-in screen', /OwnerSignIn/],
  ['owner source path', /features\/owner/],
  // `path:"/auth/owner/..."` is the shared API endpoint table (the Worker answers it on the owner host only).
  ['auth/owner path', /(?<!\bp(?:ath)?:["'`]\/)auth\/owner/],
  ['/o path', /["'`]\/o(?:["'`/?])/],
  ['owner i18n namespace', /["'`]owner:[A-Za-z]/],
  ['owner catalog file', /(?:en|gu)\/owner\.json/],
];

const ownerNames = ownerOnlyNames();
const hits = [];
for (const file of files(dir, expectHits)) {
  const rel = relative(dir, file);
  const name = basename(file);
  if (/owner/i.test(rel)) hits.push(`${rel}: file name contains "owner"`);
  const stem = name.replace(/-[A-Za-z0-9_-]{6,12}\.[a-z]+$/, '');
  if (ownerNames.includes(stem)) hits.push(`${rel}: chunk named after owner-only module ${stem}`);
  if (!TEXT.has(extname(file))) continue;
  const text = readFileSync(file, 'utf8');
  for (const [label, re] of CONTENT) {
    const m = re.exec(text);
    if (m) {
      const at = Math.max(0, m.index - 30);
      const ctx = text.slice(at, m.index + 60).replace(/\s+/g, ' ');
      hits.push(`${rel}: ${label} ("...${ctx}...")`);
    }
  }
}

if (expectHits) {
  if (hits.length === 0) {
    console.error(
      'check-staff-bundle: the combined build has no owner marker, so the check proves nothing',
    );
    process.exit(1);
  }
  console.info(
    `check-staff-bundle: the markers are live (${hits.length} hit(s) in the combined build, as expected)`,
  );
} else if (hits.length) {
  for (const h of hits.slice(0, 40)) console.error(`check-staff-bundle: ${h}`);
  if (hits.length > 40) console.error(`check-staff-bundle: ... and ${hits.length - 40} more`);
  console.error(`check-staff-bundle: ${hits.length} owner marker(s) in the staff build`);
  process.exit(1);
} else {
  console.info(
    `check-staff-bundle: ${files(dir, false).length} files in the staff build, no owner marker`,
  );
}
