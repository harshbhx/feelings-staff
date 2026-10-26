import { describe, expect, it } from 'vitest';
import { SECTION_GROUPS, SECTIONS, visibleGroups } from './sections';

describe('demo data entry on the Settings index', () => {
  const ids = (preview: boolean) => visibleGroups(preview).flatMap((g) => g.sections);

  it('is not offered unless the server says this is a preview', () => {
    expect(ids(false)).not.toContain('demo');
    expect(visibleGroups(false).map((g) => g.id)).not.toContain('developer');
  });

  it('is offered in a preview, in its own group', () => {
    expect(ids(true)).toContain('demo');
    expect(visibleGroups(true).find((g) => g.sections.includes('demo'))?.id).toBe('developer');
  });

  it('leaves every other section where it was', () => {
    const normal = SECTION_GROUPS.filter((g) => g.id !== 'developer').flatMap((g) => g.sections);
    expect(ids(false)).toEqual(normal);
    // Every section sits in exactly one group.
    const all = SECTION_GROUPS.flatMap((g) => g.sections);
    expect(new Set(all).size).toBe(all.length);
    expect(all.sort()).toEqual(SECTIONS.map((s) => s.id).sort());
  });
});
