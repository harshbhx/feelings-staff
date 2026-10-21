#!/usr/bin/env node
/**
 * Anti-slop UI checks (PRD 12.11), run in CI:
 * - no hex colours outside packages/ui/src/styles/
 * - no Tailwind default greys (gray-, slate-, zinc-, neutral-, stone-)
 * - no rounded-xl / rounded-2xl / shadow-lg / shadow-xl / bg-gradient
 * - no emoji in packages/i18n catalogs or app/src
 * - no icon sets other than Phosphor (lucide-react, react-icons, heroicons, ...)
 * Interaction layer (docs/ui-redesign-plan.md 5a, "Enforcement"):
 * - transitions animate opacity, transform and colour only (CSS and Tailwind `transition-*`)
 * - durations and easings come from the motion tokens: no literal ms or cubic-bezier in a
 *   transition or animation outside motion.css and tokens.css, no Tailwind `duration-<n>`
 * - a disabled primary Button names its reason (`disabledReason`): reported as a warning for now,
 *   the screens move to it slice by slice
 * Pressables under 44 px are caught at runtime (KIT-04, STAFF-LAYOUT).
 */
import { read, report, walk } from './lib.mjs';

const problems = [];
const code = [
  ...walk('app/src', ['.ts', '.tsx', '.css']),
  ...walk('packages/ui/src', ['.ts', '.tsx', '.css']),
  ...walk('packages/templates/src', ['.ts', '.tsx', '.css']),
];

const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const GREY =
  /\b(?:bg|text|border|ring|fill|stroke|from|to|via|outline|divide|placeholder|shadow)-(?:gray|slate|zinc|neutral|stone)-\d{2,3}\b/g;
const BANNED_CLASSES =
  /\b(?:rounded-xl|rounded-2xl|rounded-3xl|shadow-lg|shadow-xl|shadow-2xl|bg-gradient-[a-z-]+|bg-linear-[a-z0-9-]+)\b/g;
const ICON_SETS =
  /from\s+['"](?:lucide-react|react-icons[^'"]*|@heroicons\/[^'"]+|@tabler\/icons[^'"]*|@mui\/icons-material[^'"]*|react-feather|@radix-ui\/react-icons)['"]/g;
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/u;

for (const f of code) {
  const src = read(f);
  const lines = src.split('\n');
  const isStyleSource = f.startsWith('packages/ui/src/styles/');
  lines.forEach((line, i) => {
    const at = `${f}:${i + 1}`;
    if (!isStyleSource) {
      const hex = line.replace(/https?:\/\/\S+/g, '').match(HEX);
      if (hex && !/^\s*(\/\/|\*|\/\*)/.test(line))
        problems.push(`${at} hex colour ${hex.join(', ')} outside packages/ui/src/styles`);
    }
    for (const m of line.match(GREY) ?? []) problems.push(`${at} Tailwind default grey "${m}"`);
    for (const m of line.match(BANNED_CLASSES) ?? []) problems.push(`${at} banned class "${m}"`);
    for (const m of line.match(ICON_SETS) ?? []) problems.push(`${at} second icon set: ${m}`);
    if (EMOJI.test(line) && !/^\s*(\/\/|\*)/.test(line)) problems.push(`${at} emoji in UI code`);
  });
}

const MOTION_SOURCES = new Set([
  'packages/ui/src/styles/motion.css',
  'packages/ui/src/styles/tokens.css',
  'packages/ui/src/styles/index.css',
]);
const ANIMATABLE = new Set([
  'opacity',
  'transform',
  'scale',
  'translate',
  'rotate',
  'color',
  'background-color',
  'border-color',
  'outline-color',
  'text-decoration-color',
  'fill',
  'stroke',
  'visibility',
  'none',
  'all-none',
]);
const TW_TRANSITION = /\btransition-(all|shadow|\[[^\]]+\])/g;
const TW_LITERAL = /\b(?:duration|delay)-\d+\b|\bease-\[[^\]]+\]/g;

/** Top-level comma split (ignores commas inside parentheses). */
function splitTop(value) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of value) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

function interactionProblems(file, src) {
  const problems = [];
  const lineOf = (i) => src.slice(0, i).split('\n').length;
  if (file.endsWith('.css')) {
    const noComments = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
    for (const m of noComments.matchAll(/(?<![-\w])transition(-property)?\s*:\s*([^;}]+)/g)) {
      for (const part of splitTop(m[2])) {
        const decl = part.replace(/\s*!important\s*$/, '');
        const prop = m[1] ? decl : decl.split(/\s+/)[0];
        if (!ANIMATABLE.has(prop) && !/^var\(--/.test(prop))
          problems.push(
            `${file}:${lineOf(m.index)} transition animates "${prop}" (opacity, transform, colour only)`,
          );
      }
    }
    if (!MOTION_SOURCES.has(file)) {
      for (const m of noComments.matchAll(/\b\d+(?:\.\d+)?m?s\b|cubic-bezier\(/g)) {
        const line = noComments.slice(
          noComments.lastIndexOf('\n', m.index) + 1,
          noComments.indexOf('\n', m.index),
        );
        if (/(transition|animation)/.test(line) || /cubic-bezier/.test(m[0]))
          problems.push(`${file}:${lineOf(m.index)} literal "${m[0]}": use the motion tokens`);
      }
    }
  } else {
    for (const m of src.matchAll(TW_TRANSITION)) {
      const inner = m[1].startsWith('[') ? m[1].slice(1, -1).split(',') : [m[1]];
      const bad = inner.filter((p) => !ANIMATABLE.has(p.trim()));
      if (bad.length)
        problems.push(`${file}:${lineOf(m.index)} transition-${m[1]} animates ${bad.join(', ')}`);
    }
    for (const m of src.matchAll(TW_LITERAL))
      problems.push(
        `${file}:${lineOf(m.index)} "${m[0]}": use duration-(--dur-*) and the ease tokens`,
      );
    for (const m of src.matchAll(/<Button\b[^>]*?variant="primary"[^>]*?>/gs)) {
      const tag = m[0];
      if (/\bdisabled(?:=\{|\s|>)/.test(tag) && !/disabledReason=/.test(tag))
        problems.push(`${file}:${lineOf(m.index)} disabled primary Button without disabledReason`);
    }
  }
  return problems;
}

const warnings = [];
for (const f of code) {
  for (const p of interactionProblems(f, read(f))) {
    if (p.includes('disabled primary')) warnings.push(p);
    else problems.push(p);
  }
}
for (const w of warnings) console.info(`::warning title=check-ui::${w}`);

for (const f of walk('packages/i18n', ['.json'])) {
  const src = read(f);
  if (EMOJI.test(src)) problems.push(`${f}: emoji in a catalog`);
}

report('check-ui', problems);
