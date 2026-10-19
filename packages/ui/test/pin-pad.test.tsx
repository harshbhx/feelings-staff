import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PinPad } from '../src/components/PinPad';
import { renderUi } from './render';

function Controlled({ onComplete }: { onComplete?: (v: string) => void }) {
  const [pin, setPin] = useState('');
  return (
    <>
      <PinPad label="Enter your PIN" value={pin} onValueChange={setPin} onComplete={onComplete} />
      <output data-testid="pin">{pin}</output>
    </>
  );
}

describe('PinPad', () => {
  it('PRD 11.11 the keys type into a real password input with numeric inputmode', async () => {
    const user = userEvent.setup();
    renderUi(<Controlled />);
    const input = screen.getByLabelText('Enter your PIN') as HTMLInputElement;
    expect(input.type).toBe('password');
    expect(input.inputMode).toBe('numeric');
    expect(input.getAttribute('autocomplete')).toBe('one-time-code');
    await user.click(screen.getByRole('button', { name: '4' }));
    await user.click(screen.getByRole('button', { name: '8' }));
    expect(input.value).toBe('48');
    expect(screen.getByTestId('pin').textContent).toBe('48');
  });

  it('PRD 12.6 delete digit removes the last digit and is disabled when empty', async () => {
    const user = userEvent.setup();
    renderUi(<Controlled />);
    const del = screen.getByRole('button', { name: 'Delete digit' }) as HTMLButtonElement;
    expect(del.disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: '1' }));
    await user.click(screen.getByRole('button', { name: '2' }));
    await user.click(del);
    expect(screen.getByTestId('pin').textContent).toBe('1');
    await user.click(del);
    expect(screen.getByTestId('pin').textContent).toBe('');
    expect(del.disabled).toBe(true);
  });

  it('PRD 4.1 stops at the maximum length and reports completion once', async () => {
    const user = userEvent.setup();
    const done = vi.fn();
    renderUi(<Controlled onComplete={done} />);
    for (const d of ['1', '9', '7', '3', '5', '0', '2']) {
      await user.click(screen.getByRole('button', { name: d }));
    }
    expect(screen.getByTestId('pin').textContent).toBe('197350');
    expect(done).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledWith('197350');
  });

  it('PRD 11.11 typing or pasting into the input keeps digits only', async () => {
    const user = userEvent.setup();
    renderUi(<Controlled />);
    const input = screen.getByLabelText('Enter your PIN');
    await user.click(input);
    await user.keyboard('4a8-2');
    expect(screen.getByTestId('pin').textContent).toBe('482');
    await user.keyboard('{Backspace}');
    expect(screen.getByTestId('pin').textContent).toBe('48');
  });

  it('PRD 11.11 the keypad keys stay out of the tab order; the input is the one stop', async () => {
    const user = userEvent.setup();
    renderUi(<PinPad label="Enter your PIN" />);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByLabelText('Enter your PIN'));
    await user.tab();
    expect(document.activeElement).toBe(document.body);
  });

  it('PRD 11.11 an error is linked to the input and announced', () => {
    renderUi(<PinPad label="Enter your PIN" error="That PIN didn't match. 4 tries left." />);
    const input = screen.getByLabelText('Enter your PIN');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain("That PIN didn't match.");
    expect(input.getAttribute('aria-describedby')).toContain(alert.id);
  });

  it('PRD 4.1 a fixed length shows that many dots', () => {
    const { container } = renderUi(<PinPad label="Owner PIN" length={6} defaultValue="12" />);
    expect(container.querySelectorAll('.fs-pinpad__dot')).toHaveLength(6);
    expect(container.querySelectorAll('.fs-pinpad__dot[data-filled]')).toHaveLength(2);
  });
});
