#!/usr/bin/env node
/**
 * Anti-slop UI checks (PRD 12.11), run in CI:
 * - no hex colours outside packages/ui/src/styles/
 * - no Tailwind default greys (gray-, slate-, zinc-, neutral-, stone-)
 * - no rounded-xl / rounded-2xl / shadow-lg / shadow-xl / bg-gradient
 * - no emoji in packages/i18n catalogs or app/src
 * - no icon sets other than Phosphor (lucide-react, react-icons, heroicons, ...)
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

for (const f of walk('packages/i18n', ['.json'])) {
  const src = read(f);
  if (EMOJI.test(src)) problems.push(`${f}: emoji in a catalog`);
}

report('check-ui', problems);
