import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CORE_ICON_NAMES, readPaths } from '../scripts/gen-icons.mjs';
import { Icon } from '../src/icons/Icon';
import { ICON_NAMES } from '../src/icons/names';
import { CORE_ICON_PATHS } from '../src/icons/paths-core';
import { REST_ICON_PATHS } from '../src/icons/paths-rest';
import { renderUi } from './render';

const pkg = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../node_modules/@phosphor-icons/core',
);

describe('icons', () => {
  it('paths-core.ts/paths-rest.ts match @phosphor-icons/core regular (run scripts/gen-icons.mjs after adding one)', () => {
    expect(existsSync(pkg)).toBe(true);
    expect({ ...CORE_ICON_PATHS, ...REST_ICON_PATHS }).toEqual(readPaths(pkg));
  });

  it('an icon is in the core set or the rest set, never both', () => {
    const both = Object.keys(CORE_ICON_PATHS).filter((n) => n in REST_ICON_PATHS);
    expect(both).toEqual([]);
  });

  it('names.ts lists every icon exactly once', () => {
    expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length);
    expect([...ICON_NAMES].sort()).toEqual(
      Object.keys({ ...CORE_ICON_PATHS, ...REST_ICON_PATHS }).sort(),
    );
  });

  it('PRD 11.10 the staff-core set is exactly paths-core.ts (run gen-icons.mjs after changing it)', () => {
    expect(Object.keys(CORE_ICON_PATHS).sort()).toEqual([...CORE_ICON_NAMES].sort());
  });

  it('PRD 12.7 decorative icons are hidden from screen readers', () => {
    const { container } = renderUi(<Icon name="clock" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('focusable')).toBe('false');
  });

  it('PRD 12.7 a labelled icon is an image with that name', () => {
    renderUi(<Icon name="wifi-slash" label="Offline" />);
    expect(screen.getByRole('img', { name: 'Offline' })).toBeTruthy();
  });
});
