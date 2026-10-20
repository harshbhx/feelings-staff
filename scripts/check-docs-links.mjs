#!/usr/bin/env node
/**
 * Docs link check: every relative Markdown link in README.md, CONTRIBUTING.md, SECURITY.md,
 * CHANGELOG.md and docs/**.md must point to a file that exists, and a `#heading` part must match a
 * heading in the target file. External links (http, https, mailto) are not fetched.
 *
 *   node scripts/check-docs-links.mjs
 *
 * Reads files only. Exit code 1 lists every broken link.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

function collect(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) collect(p, out);
    else if (name.endsWith('.md')) out.push(p);
  }
  return out;
}

const files = [
  ...['README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'CHANGELOG.md']
    .map((f) => join(root, f))
    .filter(existsSync),
  ...collect(join(root, 'docs')),
];

/** GitHub-style heading slug. */
function slug(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

function stripCode(text) {
  return text.replace(/^(```|~~~)[\s\S]*?^\1/gm, '');
}

const anchorCache = new Map();
function anchors(file) {
  if (anchorCache.has(file)) return anchorCache.get(file);
  const set = new Set();
  const seen = new Map();
  for (const m of stripCode(readFileSync(file, 'utf8')).matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const base = slug(m[1]);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    set.add(n === 0 ? base : `${base}-${n}`);
  }
  anchorCache.set(file, set);
  return set;
}

const problems = [];
let checked = 0;
for (const file of files) {
  const text = stripCode(readFileSync(file, 'utf8')).replace(/`[^`\n]*`/g, '');
  for (const m of text.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const href = m[1];
    if (/^(https?:|mailto:|tel:)/.test(href)) continue;
    const [pathPart, hash] = href.split('#');
    const target = pathPart === '' ? file : resolve(dirname(file), decodeURI(pathPart));
    checked++;
    const rel = file.slice(root.length + 1);
    if (!existsSync(target)) {
      problems.push(`${rel}: ${href} (file not found)`);
      continue;
    }
    if (hash && target.endsWith('.md') && !statSync(target).isDirectory()) {
      if (!anchors(target).has(hash.toLowerCase()))
        problems.push(`${rel}: ${href} (no such heading)`);
    }
  }
}

if (problems.length) {
  process.stderr.write(
    `${problems.length} broken link(s):\n${problems.map((p) => `  ${p}`).join('\n')}\n`,
  );
  process.exit(1);
}
process.stdout.write(`Docs links OK: ${checked} relative links in ${files.length} files.\n`);
