import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SLOW_AFTER_MS, useAction } from './useAction';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useAction (docs/ui-redesign-plan.md 5a)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is pending from the press to the answer, and a second press while pending is ignored', async () => {
    const d = deferred<string>();
    const fn = vi.fn((_signal: AbortSignal) => d.promise);
    const { result } = renderHook(() => useAction(fn));
    let first!: Promise<string | undefined>;
    let second!: Promise<string | undefined>;
    act(() => {
      first = result.current.run();
      second = result.current.run();
    });
    expect(result.current.pending).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
    await act(async () => {
      d.resolve('ok');
      await first;
    });
    expect(await second).toBeUndefined();
    expect(result.current.pending).toBe(false);
  });

  it('says it is slow after 8 s without an answer', async () => {
    vi.useFakeTimers();
    const d = deferred<void>();
    const { result } = renderHook(() => useAction(() => d.promise));
    let run: Promise<unknown> = Promise.resolve();
    act(() => {
      run = result.current.run();
    });
    act(() => {
      vi.advanceTimersByTime(SLOW_AFTER_MS - 1);
    });
    expect(result.current.slow).toBe(false);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.slow).toBe(true);
    await act(async () => {
      d.resolve();
      await run;
    });
    expect(result.current.slow).toBe(false);
  });

  it('is not optimistic by default; an optimistic change rolls back when the call fails', async () => {
    const plain = renderHook(() => useAction(() => Promise.reject(new Error('no'))));
    await act(async () => {
      await plain.result.current.run();
    });
    expect(plain.result.current.error).toBeInstanceOf(Error);

    const log: string[] = [];
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useAction(() => Promise.reject(new Error('offline')), {
        optimistic: () => {
          log.push('apply');
          return () => log.push('undo');
        },
        onError,
      }),
    );
    await act(async () => {
      await result.current.run();
    });
    expect(log).toEqual(['apply', 'undo']);
    expect(onError).toHaveBeenCalledOnce();
  });

  it('cancel aborts the signal and hands the control back at once', async () => {
    const seen: { signal: AbortSignal | null } = { signal: null };
    const d = deferred<void>();
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useAction(
        (signal) => {
          seen.signal = signal;
          return d.promise;
        },
        { onError },
      ),
    );
    let run: Promise<unknown> = Promise.resolve();
    act(() => {
      run = result.current.run();
    });
    act(() => result.current.cancel());
    expect(seen.signal?.aborted).toBe(true);
    expect(result.current.pending).toBe(false);
    await act(async () => {
      d.reject(new DOMException('aborted', 'AbortError'));
      await run;
    });
    expect(onError).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
  });
});
