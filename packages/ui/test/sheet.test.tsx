import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Button } from '../src/components/Button';
import { Input } from '../src/components/Field';
import { Sheet } from '../src/components/Sheet';
import { renderUi } from './render';

function Example({ dismissible = true }: { dismissible?: boolean }) {
  return (
    <Sheet
      trigger={<Button>Edit day</Button>}
      title="Edit day"
      description="Priya sees the reason."
      dismissible={dismissible}
      footer={<Button variant="primary">Save</Button>}
    >
      <Input aria-label="Reason" />
    </Sheet>
  );
}

describe('Sheet', () => {
  it('PRD 11.11 opens as a labelled dialog and traps focus inside', async () => {
    const user = userEvent.setup();
    renderUi(<Example />);
    await user.click(screen.getByRole('button', { name: 'Edit day' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit day' });
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
    const inside = () => dialog.contains(document.activeElement);
    expect(inside()).toBe(true);
    for (let i = 0; i < 6; i++) {
      await user.tab();
      expect(inside()).toBe(true);
    }
    await user.tab({ shift: true });
    expect(inside()).toBe(true);
  });

  it('PRD 11.11 Escape closes it and focus returns to the trigger', async () => {
    const user = userEvent.setup();
    renderUi(<Example />);
    const trigger = screen.getByRole('button', { name: 'Edit day' });
    await user.click(trigger);
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('PRD 12.6 the close button is labelled from the ui catalog', async () => {
    const user = userEvent.setup();
    renderUi(<Example />);
    await user.click(screen.getByRole('button', { name: 'Edit day' }));
    await user.click(await screen.findByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('PRD 4.3 a sheet that must not be lost ignores Escape and has no close button', async () => {
    const user = userEvent.setup();
    renderUi(<Example dismissible={false} />);
    await user.click(screen.getByRole('button', { name: 'Edit day' }));
    await screen.findByRole('dialog');
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
