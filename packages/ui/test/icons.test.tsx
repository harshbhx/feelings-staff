import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { readPaths } from '../scripts/gen-icons.mjs';
import { Icon } from '../src/icons/Icon';
import { ICON_PATHS } from '../src/icons/paths';
import { renderUi } from './render';

const pkg = fileURLToPath(new URL('../node_modules/@phosphor-icons/core', import.meta.url));

describe('icons', () => {
  it('paths.ts matches @phosphor-icons/core regular (run scripts/gen-icons.mjs after adding one)', () => {
    expect(existsSync(pkg)).toBe(true);
    expect(readPaths(pkg)).toEqual(ICON_PATHS);
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
