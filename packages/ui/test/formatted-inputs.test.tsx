import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Field } from '../src/components/Field';
import {
  CodeField,
  formatIndianMobile,
  formatJoinCode,
  PhoneField,
  parseTime24,
  TimeField,
} from '../src/components/FormattedInputs';
import { renderUi } from './render';

describe('CodeField', () => {
  it('S-01 a join code is formatted XXX-XXXXX as it is typed, Crockford-normalised', async () => {
    const user = userEvent.setup();
    const change = vi.fn();
    const done = vi.fn();
    renderUi(
      <Field label="Join code">
        <CodeField onValueChange={change} onComplete={done} />
      </Field>,
    );
    const input = screen.getByLabelText('Join code') as HTMLInputElement;
    await user.type(input, 'k7q4');
    expect(input.value).toBe('K7Q-4');
    await user.type(input, 'mz2o');
    expect(input.value).toBe('K7Q-4MZ20');
    expect(change).toHaveBeenLastCalledWith('K7Q4MZ20');
    expect(done).toHaveBeenCalledWith('K7Q4MZ20');
  });

  it('S-01 a pasted code with spaces or a hyphen comes out the same', () => {
    expect(formatJoinCode('k7q 4mz-2p')).toBe('K7Q-4MZ2P');
    expect(formatJoinCode('il0u')).toBe('110');
  });

  it('O-01 the owner code takes 6 digits only', async () => {
    const user = userEvent.setup();
    const done = vi.fn();
    renderUi(
      <Field label="Code from the email">
        <CodeField variant="otp6" onComplete={done} />
      </Field>,
    );
    const input = screen.getByLabelText('Code from the email') as HTMLInputElement;
    await user.type(input, '48a21937');
    expect(input.value).toBe('482193');
    expect(done).toHaveBeenCalledWith('482193');
  });
});

describe('PhoneField', () => {
  it('S-01 formats as 98765 43210 and returns ten digits', async () => {
    const user = userEvent.setup();
    const change = vi.fn();
    renderUi(
      <Field label="Phone number">
        <PhoneField onValueChange={change} />
      </Field>,
    );
    const input = screen.getByLabelText('Phone number') as HTMLInputElement;
    await user.type(input, '9876543210');
    expect(input.value).toBe('98765 43210');
    expect(change).toHaveBeenLastCalledWith('9876543210');
    expect(formatIndianMobile('+91 98765-43210'.replace('+91', ''))).toBe('98765 43210');
  });
});

describe('TimeField', () => {
  it('PRD 12.6 digits become a 24 h time', async () => {
    const user = userEvent.setup();
    renderUi(
      <Field label="Check-in time">
        <TimeField />
      </Field>,
    );
    const input = screen.getByLabelText('Check-in time') as HTMLInputElement;
    await user.type(input, '1902');
    expect(input.value).toBe('19:02');
  });

  it('PRD 12.6 parses and tidies typed times', () => {
    expect(parseTime24('9:05')).toBe('09:05');
    expect(parseTime24('2004')).toBe('20:04');
    expect(parseTime24('24:00')).toBeNull();
    expect(parseTime24('10:60')).toBeNull();
  });
});
