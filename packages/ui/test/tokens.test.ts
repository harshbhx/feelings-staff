import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = (p: string) =>
  readFileSync(fileURLToPath(new URL(`../../../${p}`, import.meta.url)), 'utf8');

/** The first ```css block after `heading` in a Markdown file. */
function cssBlock(md: string, heading: string): string {
  const from = md.indexOf(heading);
  const start = md.indexOf('```css\n', from) + '```css\n'.length;
  return md.slice(start, md.indexOf('\n```', start) + 1);
}

describe('brand tokens', () => {
  it('tokens.css is a byte-for-byte copy of brand-and-stack.md 6.1 (PRD 12.1)', () => {
    const doc = cssBlock(root('docs/research/brand-and-stack.md'), '### 6.1');
    expect(root('packages/ui/src/styles/tokens.css')).toBe(doc);
  });

  it('app-tokens.css is exactly the PRD 12.3 block', () => {
    const doc = cssBlock(root('docs/PRD.md'), '### 12.3');
    expect(root('packages/ui/src/styles/app-tokens.css')).toBe(doc);
  });

  it('hex colours live only in the styles folder, and only brand or status values', () => {
    const allowed = new Set(
      [...root('packages/ui/src/styles/tokens.css').matchAll(/#[0-9a-f]{6}\b/gi)]
        .concat([...root('packages/ui/src/styles/app-tokens.css').matchAll(/#[0-9a-f]{6}\b/gi)])
        .map((m) => m[0].toLowerCase()),
    );
    const theme = root('packages/ui/src/styles/index.css');
    for (const m of theme.matchAll(/#[0-9a-f]{3,8}\b/gi)) {
      expect(allowed.has(m[0].toLowerCase()), m[0]).toBe(true);
    }
  });
});
