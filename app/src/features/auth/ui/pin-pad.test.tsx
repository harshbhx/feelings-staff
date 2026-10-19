import { createI18n } from '@fs/i18n';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { STAFF_PIN } from '../lib/inputs';
import { PinPad, pressKey } from './pin-pad';

describe('PIN pad (PRD 11.11, 12.6)', () => {
  it('adds digits up to the maximum and deletes the last one', () => {
    expect(pressKey('', '1', 6)).toBe('1');
    expect(pressKey('12345', '6', 6)).toBe('123456');
    expect(pressKey('123456', '7', 6)).toBe('123456');
    expect(pressKey('123', 'delete', 6)).toBe('12');
    expect(pressKey('', 'delete', 6)).toBe('');
    expect(pressKey('12', 'x', 6)).toBe('12');
  });

  it('keys and the real password input drive the same value; a fixed PIN completes', async () => {
    const i18n = await createI18n('en');
    const onComplete = vi.fn();
    function Harness({ fixed }: { fixed: boolean }) {
      const [pin, setPin] = useState('');
      return (
        <I18nextProvider i18n={i18n}>
          <PinPad
            label="PIN"
            value={pin}
            onChange={setPin}
            length={fixed ? { min: 6, max: 6 } : STAFF_PIN}
            onComplete={onComplete}
          />
        </I18nextProvider>
      );
    }
    const { container, unmount } = render(<Harness fixed={false} />);
    const input = screen.getByLabelText('PIN') as HTMLInputElement;
    expect(input.type).toBe('password');
    expect(input.getAttribute('inputmode')).toBe('numeric');
    expect(input.getAttribute('autocomplete')).toBe('one-time-code');

    const key = (k: string) => {
      const el = container.querySelector(`[data-key="${k}"]`);
      if (!el) throw new Error(`no key ${k}`);
      act(() => {
        fireEvent.click(el);
      });
    };
    key('2');
    key('5');
    key('8');
    expect(input.value).toBe('258');
    key('delete');
    expect(input.value).toBe('25');
    act(() => {
      fireEvent.change(input, { target: { value: '25a80' } });
    });
    expect(input.value).toBe('2580');
    expect(onComplete).not.toHaveBeenCalled();
    unmount();

    const fixed = render(<Harness fixed />);
    const ownerInput = fixed.getByLabelText('PIN') as HTMLInputElement;
    act(() => {
      fireEvent.change(ownerInput, { target: { value: '482913' } });
    });
    expect(onComplete).toHaveBeenCalledWith('482913');
  });
});
