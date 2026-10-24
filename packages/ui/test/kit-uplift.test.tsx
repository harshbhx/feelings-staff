import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Badge } from '../src/components/Badge';
import { Card } from '../src/components/Card';
import { List, ListRow } from '../src/components/ListRow';
import { ProgressStrip } from '../src/components/ProgressStrip';
import { RailGroup, RailItem, RailNav } from '../src/components/Rail';
import { ShiftTimeline } from '../src/components/ShiftTimeline';
import { SkeletonList } from '../src/components/Skeleton';
import { StatChipGroup } from '../src/components/StatChip';
import { renderUi } from './render';

const styles = resolve(dirname(fileURLToPath(import.meta.url)), '../src/styles');

describe('WP-10 kit tokens', () => {
  it('PRD 12.1 intent-tokens.css adds aliases only, never a new colour value', () => {
    const css = readFileSync(resolve(styles, 'intent-tokens.css'), 'utf8');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/rgb\(|hsl\(|oklch\(/i);
  });

  it('iOS layer: the tab bar is a floating material capsule', () => {
    const css = readFileSync(resolve(styles, 'components/tabbar.css'), 'utf8');
    expect(css).toMatch(/background: var\(--material-cell\)/);
    expect(css).toMatch(/backdrop-filter: var\(--blur\)/);
  });

  it('iOS layer: ios.css brings no new hue (brand and status hex only)', () => {
    const known = new Set(
      ['tokens.css', 'app-tokens.css'].flatMap((f) =>
        [...readFileSync(resolve(styles, f), 'utf8').matchAll(/#[0-9a-f]{6}\b/gi)].map((m) =>
          m[0].toLowerCase(),
        ),
      ),
    );
    const css = readFileSync(resolve(styles, 'ios.css'), 'utf8');
    for (const m of css.matchAll(/#[0-9a-f]{3,8}\b/gi))
      expect(known.has(m[0].toLowerCase())).toBe(true);
  });
});

describe('Badge', () => {
  it('PRD 12.3 a badge is a tone, an icon and a word', () => {
    const { container } = renderUi(
      <Badge tone="success" icon="map-pin">
        Inside
      </Badge>,
    );
    const el = container.querySelector('.fs-status');
    expect(el?.getAttribute('data-tone')).toBe('success');
    expect(el?.querySelector('svg')).toBeTruthy();
    expect(el?.textContent).toBe('Inside');
  });
});

describe('StatChipGroup', () => {
  const options = [
    { value: 'all', label: 'everyone', count: 11 },
    { value: 'in', label: 'in', count: 8, tone: 'present' as const },
    { value: 'late', label: 'late', count: 3, tone: 'late' as const },
  ];

  it('WP-10 fix 2 each count is a real radio named by its number and word', async () => {
    const user = userEvent.setup();
    const change = vi.fn();
    renderUi(
      <StatChipGroup legend="Show" defaultValue="all" options={options} onValueChange={change} />,
    );
    expect(screen.getByRole('group', { name: 'Show' })).toBeTruthy();
    const late = screen.getByRole('radio', { name: '3 late' });
    expect((screen.getByRole('radio', { name: '11 everyone' }) as HTMLInputElement).checked).toBe(
      true,
    );
    await user.click(late);
    expect(change).toHaveBeenCalledWith('late');
    expect((late as HTMLInputElement).checked).toBe(true);
  });

  it('WP-10 fix 2 a controlled group follows its value', () => {
    renderUi(<StatChipGroup legend="Show" value="in" options={options} />);
    expect((screen.getByRole('radio', { name: '8 in' }) as HTMLInputElement).checked).toBe(true);
  });
});

describe('ProgressStrip', () => {
  it('WP-10 fix 2 the strip says the day in words and sizes each segment by its share', () => {
    const { container } = renderUi(
      <ProgressStrip
        label="8 of 11 in"
        total={11}
        description="8 of 11 in: 5 on time, 3 late"
        segments={[
          { key: 'on-time', value: 5, tone: 'present', label: '5 on time' },
          { key: 'late', value: 3, tone: 'late', label: '3 late' },
          { key: 'none', value: 0, tone: 'absent', label: '0 absent' },
        ]}
      />,
    );
    expect(screen.getByText('8 of 11 in')).toBeTruthy();
    expect(screen.getByRole('img', { name: '8 of 11 in: 5 on time, 3 late' })).toBeTruthy();
    const segs = Array.from(container.querySelectorAll<HTMLElement>('.fs-meter__seg'));
    expect(segs).toHaveLength(2);
    expect(Number.parseFloat(segs[0]?.style.width ?? '')).toBeCloseTo((5 / 11) * 100, 3);
    // PRD 12.3: the legend repeats every colour with an icon and a word.
    const legend = container.querySelectorAll('.fs-meter__legend > li');
    expect(Array.from(legend, (li) => li.textContent)).toEqual(['5 on time', '3 late']);
    for (const li of Array.from(legend)) expect(li.querySelector('svg')).toBeTruthy();
  });
});

describe('Card', () => {
  it('PRD 12.5 a titled card is a section named by its heading', () => {
    renderUi(
      <Card title="Not in yet" description="Shift started at 10:00.">
        <p>Kajal</p>
      </Card>,
    );
    expect(screen.getByRole('region', { name: 'Not in yet' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Not in yet' })).toBeTruthy();
  });
});

describe('ListRow meta', () => {
  it('WP-10 fix 8 badges sit under the subtitle, inside the row text', () => {
    const { container } = renderUi(
      <List>
        <ListRow
          title="Sejal Makwana"
          subtitle="In 10:21"
          meta={
            <Badge tone="warning" icon="warning-circle">
              Edge
            </Badge>
          }
        />
      </List>,
    );
    expect(container.querySelector('.fs-row__text .fs-row__meta')?.textContent).toBe('Edge');
  });
});

describe('RailNav', () => {
  it('WP-10 fix 7 the active item is marked for screen readers, with its icon and count', () => {
    renderUi(
      <RailNav label="Owner">
        <RailGroup>
          <RailItem href="#today" icon="calendar-check" label="Today" current />
          <RailItem href="#actions" icon="warning-circle" label="Needs action" badge={9} />
        </RailGroup>
        <RailGroup label="Money">
          <RailItem href="#payroll" icon="currency-inr" label="Payroll" />
        </RailGroup>
      </RailNav>,
    );
    const nav = screen.getByRole('navigation', { name: 'Owner' });
    expect(nav).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Today' }).getAttribute('aria-current')).toBe('page');
    const actions = screen.getByRole('link', { name: /^Needs action/ });
    expect(actions.getAttribute('aria-current')).toBe(null);
    expect(actions.querySelector('svg')).toBeTruthy();
    expect(actions.textContent).toContain('9');
    expect(screen.getByRole('list', { name: 'Money' })).toBeTruthy();
  });
});

describe('SkeletonList', () => {
  it('PRD 5 placeholder rows announce one loading label', () => {
    renderUi(<SkeletonList rows={4} trailing label="Loading the register" />);
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('Loading the register');
    expect(status.querySelectorAll('.fs-skeleton-list__row')).toHaveLength(4);
  });
});

describe('ShiftTimeline', () => {
  it('WP-10 fix 5 the worked part and the now marker sit at their share of the shift', () => {
    const { container } = renderUi(
      <ShiftTimeline
        start={600}
        end={1200}
        startLabel="10:00"
        endLabel="20:00"
        now={900}
        worked={[{ from: 600, to: 900 }]}
        description="Shift 10:00 to 20:00, now 15:00"
      />,
    );
    expect(screen.getByRole('img', { name: 'Shift 10:00 to 20:00, now 15:00' })).toBeTruthy();
    const now = container.querySelector<HTMLElement>('.fs-shift__now');
    expect(now?.style.left).toBe('50%');
    const worked = container.querySelector<HTMLElement>('.fs-shift__worked');
    expect(worked?.style.left).toBe('0%');
  });

  it('WP-10 fix 5 now outside the shift stays at the nearer end', () => {
    const { container } = renderUi(
      <ShiftTimeline
        start={600}
        end={1200}
        startLabel="10:00"
        endLabel="20:00"
        now={500}
        description="x"
      />,
    );
    expect(container.querySelector<HTMLElement>('.fs-shift__now')?.style.left).toBe('0%');
  });

  it('WP-10 fix 5 now after the shift ends stays at the end', () => {
    const { container } = renderUi(
      <ShiftTimeline
        start={600}
        end={1200}
        startLabel="10:00"
        endLabel="20:00"
        now={1500}
        description="x"
      />,
    );
    expect(container.querySelector<HTMLElement>('.fs-shift__now')?.style.left).toBe('100%');
  });
});
