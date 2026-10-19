import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ChipGroup } from '../src/components/Chip';
import { renderUi } from './render';

const LEAVE = [
  { value: 'casual', label: 'Casual', description: '2 days left' },
  { value: 'sick', label: 'Sick', description: '3 days left' },
  { value: 'unpaid', label: 'Unpaid' },
];

describe('ChipGroup', () => {
  it('PRD 12.6 radios: a fieldset of real radios named by the legend', () => {
    renderUi(<ChipGroup legend="Leave type" options={LEAVE} />);
    const group = screen.getByRole('group', { name: 'Leave type' });
    expect(group.tagName).toBe('FIELDSET');
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    const casual = screen.getByRole('radio', { name: 'Casual' });
    expect(casual.getAttribute('aria-describedby')).toBeTruthy();
  });

  it('PRD 11.11 arrow keys move the choice between radios', async () => {
    const user = userEvent.setup();
    const change = vi.fn();
    renderUi(
      <ChipGroup
        legend="Leave type"
        options={LEAVE}
        defaultValue="casual"
        onValueChange={change}
      />,
    );
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Casual' }));
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Sick' })).toHaveProperty('checked', true);
    expect(change).toHaveBeenLastCalledWith('sick');
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('radio', { name: 'Unpaid' })).toHaveProperty('checked', true);
    expect(change).toHaveBeenLastCalledWith('unpaid');
  });

  it('PRD 11.11 checkboxes: Tab between chips, Space toggles', async () => {
    const user = userEvent.setup();
    const change = vi.fn();
    renderUi(
      <ChipGroup
        type="checkbox"
        legend="What went wrong"
        options={[
          { value: 'in', label: 'Missed check-in' },
          { value: 'out', label: 'Missed check-out' },
        ]}
        onValueChange={change}
      />,
    );
    await user.tab();
    await user.keyboard(' ');
    expect(change).toHaveBeenLastCalledWith(['in']);
    await user.tab();
    await user.keyboard(' ');
    expect(change).toHaveBeenLastCalledWith(['in', 'out']);
    await user.keyboard(' ');
    expect(change).toHaveBeenLastCalledWith(['in']);
  });

  it('PRD 11.11 an error is linked to the group', () => {
    renderUi(<ChipGroup legend="Mode" options={LEAVE} error="Choose how staff check in." />);
    const group = screen.getByRole('group', { name: 'Mode' });
    const alert = screen.getByRole('alert');
    expect(group.getAttribute('aria-describedby')).toContain(alert.id);
  });

  it('PRD 12.6 a count is part of the chip name', () => {
    renderUi(<ChipGroup legend="Show" options={[{ value: 'late', label: 'Late', count: 2 }]} />);
    expect(screen.getByRole('radio', { name: 'Late 2' })).toBeTruthy();
  });
});
