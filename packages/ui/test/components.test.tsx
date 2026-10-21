import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Avatar, initials } from '../src/components/Avatar';
import { Button, IconButton } from '../src/components/Button';
import { Field, Input, PasswordInput } from '../src/components/Field';
import { type DayStatus, STATUS_HAS_LETTER, StatusChip } from '../src/components/StatusChip';
import { renderUi } from './render';

const ui = JSON.parse(
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../i18n/en/ui.json'), 'utf8'),
) as { status: Record<string, { word?: string; letter?: string }> };

describe('Button', () => {
  it('PRD 5 a submitting button shows its new label and ignores presses', async () => {
    const user = userEvent.setup();
    const click = vi.fn();
    renderUi(
      <Button variant="primary" loading loadingLabel="Checking in…" onClick={click}>
        Check in
      </Button>,
    );
    const btn = screen.getByRole('button', { name: 'Checking in…' });
    expect(btn.getAttribute('aria-busy')).toBe('true');
    await user.click(btn);
    expect(click).not.toHaveBeenCalled();
  });

  it('PRD 12.6 IconButton always has an accessible name', () => {
    renderUi(<IconButton icon="bell" label="Notifications, 3 new" dot />);
    expect(screen.getByRole('button', { name: 'Notifications, 3 new' })).toBeTruthy();
  });
});

describe('Field', () => {
  it('PRD 11.11 label, hint and error are wired to the input', () => {
    renderUi(
      <Field label="Phone number" hint="The number Urmi has for you." error="Type 10 digits.">
        <Input start="+91" />
      </Field>,
    );
    const input = screen.getByLabelText('Phone number');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const ids = input.getAttribute('aria-describedby')?.split(' ') ?? [];
    const text = ids.map((id) => document.getElementById(id)?.textContent).join(' | ');
    expect(text).toContain('Type 10 digits.');
    expect(text).toContain('The number Urmi has for you.');
  });

  it('PRD 12.6 the password toggle shows and hides the value', async () => {
    const user = userEvent.setup();
    renderUi(
      <Field label="Password">
        <PasswordInput />
      </Field>,
    );
    const input = screen.getByLabelText('Password') as HTMLInputElement;
    expect(input.type).toBe('password');
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(input.type).toBe('text');
    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(input.type).toBe('password');
  });
});

describe('StatusChip', () => {
  const all: DayStatus[] = Object.keys(STATUS_HAS_LETTER) as DayStatus[];

  it('PRD 12.3 every status has a word, and a letter where the register uses one', () => {
    for (const s of all) {
      expect(ui.status[s]?.word, s).toBeTruthy();
      if (STATUS_HAS_LETTER[s]) expect(ui.status[s]?.letter, s).toBeTruthy();
    }
  });

  it('PRD 12.3 status is icon + word, never colour alone', () => {
    const { container } = renderUi(<StatusChip status="absent" />);
    expect(container.textContent).toBe('Absent');
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('PRD 12.3 the letter variant keeps the word for screen readers', () => {
    const { container } = renderUi(<StatusChip status="half" variant="letter" />);
    expect(container.querySelector('[aria-hidden="true"]:not(svg)')?.textContent).toBe('H');
    expect(container.querySelector('.sr-only')?.textContent).toBe('Half day');
  });
});

describe('Avatar', () => {
  it('PRD 12.6 initials come from the first and last name', () => {
    expect(initials('Priya Shah')).toBe('PS');
    expect(initials('  neha  ')).toBe('N');
    expect(initials('Kajal Ben Mehta')).toBe('KM');
  });

  it('PRD 12.6 as amended: the role tone is a data attribute, blush without one', () => {
    const { container } = renderUi(
      <>
        <Avatar name="Sejal Makwana" tone="makeup" />
        <Avatar name="Urmi" />
      </>,
    );
    const [toned, plain] = container.querySelectorAll('.fs-avatar');
    expect(toned?.getAttribute('data-tone')).toBe('makeup');
    expect(toned?.hasAttribute('tone')).toBe(false);
    expect(plain?.hasAttribute('data-tone')).toBe(false);
  });
});
