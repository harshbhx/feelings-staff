import { ApiError } from '@fs/contracts';
import { createMockApiClient } from '@fs/contracts/mock';
import { createI18n } from '@fs/i18n';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/provider';
import {
  createStepUpRunner,
  isStepUpCancelled,
  StepUpCancelledError,
  StepUpProvider,
  useStepUp,
} from './step-up';

const stepUpRequired = () => new ApiError({ code: 'STEP_UP_REQUIRED', status: 403 });

describe('step-up runner (PRD 4.1.7 step 4, O-01.4)', () => {
  it('O-01.4 runs the action, asks for the PIN on STEP_UP_REQUIRED, then retries once', async () => {
    const request = vi.fn(async () => undefined);
    const action = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(stepUpRequired())
      .mockResolvedValue('approved');
    await expect(createStepUpRunner(request)(action)).resolves.toBe('approved');
    expect(request).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledTimes(2);
  });

  it('does not ask when the action succeeds, and passes other errors through', async () => {
    const request = vi.fn(async () => undefined);
    const run = createStepUpRunner(request);
    await expect(run(async () => 1)).resolves.toBe(1);
    const other = new ApiError({ code: 'FORBIDDEN', status: 403 });
    await expect(run(() => Promise.reject(other))).rejects.toBe(other);
    expect(request).not.toHaveBeenCalled();
  });

  it('retries only once, and a cancelled sheet rejects without running again', async () => {
    const twice = vi.fn(() => Promise.reject(stepUpRequired()));
    await expect(createStepUpRunner(async () => undefined)(twice)).rejects.toMatchObject({
      code: 'STEP_UP_REQUIRED',
    });
    expect(twice).toHaveBeenCalledTimes(2);

    const action = vi.fn(() => Promise.reject(stepUpRequired()));
    const cancelled = createStepUpRunner(() => Promise.reject(new StepUpCancelledError()));
    const outcome = await cancelled(action).catch((e: unknown) => e);
    expect(isStepUpCancelled(outcome)).toBe(true);
    expect(action).toHaveBeenCalledTimes(1);
  });
});

describe('StepUpProvider and useStepUp', () => {
  it('O-01.4 shows the PIN sheet, sends the owner PIN, and finishes the action', async () => {
    const i18n = await createI18n('en');
    const stepUp = vi.fn(() => ({ stepUpUntil: 1792387320000 }));
    const client = createMockApiClient({ overrides: { stepUp } });
    const action = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(stepUpRequired())
      .mockResolvedValue('device approved');

    function Owner() {
      const { run } = useStepUp();
      const [result, setResult] = useState('');
      return (
        <>
          <button type="button" onClick={() => void run(action).then(setResult)}>
            Approve
          </button>
          <output>{result}</output>
        </>
      );
    }

    render(
      <ApiProvider client={client}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter>
            <StepUpProvider>
              <Owner />
            </StepUpProvider>
          </MemoryRouter>
        </I18nextProvider>
      </ApiProvider>,
    );

    act(() => {
      fireEvent.click(screen.getByText('Approve'));
    });
    const pin = (await screen.findByLabelText('Owner PIN')) as HTMLInputElement;
    expect(screen.getByText('Enter your owner PIN')).toBeTruthy();
    act(() => {
      fireEvent.change(pin, { target: { value: '482913' } });
    });
    await waitFor(() => expect(screen.getByText('device approved')).toBeTruthy());
    expect(stepUp).toHaveBeenCalledWith({ body: { pin: '482913' } });
    expect(action).toHaveBeenCalledTimes(2);
  });

  it('cancel rejects with StepUpCancelledError', async () => {
    const i18n = await createI18n('en');
    const client = createMockApiClient();
    let outcome: unknown = null;

    function Owner() {
      const { run } = useStepUp();
      return (
        <button
          type="button"
          onClick={() =>
            void run(() => Promise.reject(stepUpRequired())).catch((e: unknown) => {
              outcome = e;
            })
          }
        >
          Finalise
        </button>
      );
    }

    render(
      <ApiProvider client={client}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter>
            <StepUpProvider>
              <Owner />
            </StepUpProvider>
          </MemoryRouter>
        </I18nextProvider>
      </ApiProvider>,
    );
    act(() => {
      fireEvent.click(screen.getByText('Finalise'));
    });
    const cancel = await screen.findByText('Cancel');
    act(() => {
      fireEvent.click(cancel);
    });
    await waitFor(() => expect(isStepUpCancelled(outcome)).toBe(true));
  });
});
