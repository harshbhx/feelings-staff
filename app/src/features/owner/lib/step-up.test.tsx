import { ApiError } from '@fs/contracts';
import { act, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  isStepUpCancelled,
  StepUpProvider,
  type StepUpRunner,
  type StepUpSheetProps,
  useStepUp,
} from './step-up';

interface Holder {
  runner: StepUpRunner | null;
  sheet: StepUpSheetProps | null;
}

function setup() {
  const h: Holder = { runner: null, sheet: null };
  function Grab() {
    h.runner = useStepUp();
    return null;
  }
  render(
    <StepUpProvider
      renderSheet={(p) => {
        h.sheet = p;
        return null;
      }}
    >
      <Grab />
    </StepUpProvider>,
  );
  const run = <T,>(fn: () => Promise<T>): Promise<T> => {
    const r = h.runner;
    if (!r) throw new Error('not rendered');
    return r(fn);
  };
  return { run, h };
}

const stepUpRequired = () => new ApiError({ code: 'STEP_UP_REQUIRED', status: 403 });
const flush = () => act(async () => {});

describe('step-up runner (O-01.4 on owner screens)', () => {
  it('runs the action straight away when no PIN is needed', async () => {
    const s = setup();
    await expect(s.run(async () => 'ok')).resolves.toBe('ok');
    expect(s.h.sheet?.open).toBe(false);
  });

  it('asks for the PIN on STEP_UP_REQUIRED, then retries the same action', async () => {
    const s = setup();
    let calls = 0;
    const result = s.run(async () => {
      calls += 1;
      if (calls === 1) throw stepUpRequired();
      return 'finalised';
    });
    await flush();
    expect(s.h.sheet?.open).toBe(true);
    await act(async () => s.h.sheet?.onVerified());
    await expect(result).resolves.toBe('finalised');
    expect(calls).toBe(2);
    await flush();
    expect(s.h.sheet?.open).toBe(false);
  });

  it('cancelling the PIN sheet rejects with StepUpCancelled', async () => {
    const s = setup();
    const result = s.run(async () => {
      throw stepUpRequired();
    });
    const settled = result.catch((e: unknown) => e);
    await flush();
    await act(async () => s.h.sheet?.onCancel());
    expect(isStepUpCancelled(await settled)).toBe(true);
  });

  it('passes other errors through untouched', async () => {
    const s = setup();
    const err = new ApiError({ code: 'MONTH_LOCKED', status: 409 });
    await expect(
      s.run(async () => {
        throw err;
      }),
    ).rejects.toBe(err);
  });
});
