import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useHeldBack } from './use-held-back';

describe('useHeldBack (the notice waits for another sheet to be gone)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('is not held back when nothing was open', () => {
    const { result } = renderHook(() => useHeldBack(false, 300));
    expect(result.current).toBe(false);
  });

  it('is held back at once when a sheet is open', () => {
    const { result, rerender } = renderHook(({ b }) => useHeldBack(b, 300), {
      initialProps: { b: false },
    });
    rerender({ b: true });
    expect(result.current).toBe(true);
  });

  it('stays held back for the exit animation after the sheet closes, then lets go', () => {
    const { result, rerender } = renderHook(({ b }) => useHeldBack(b, 300), {
      initialProps: { b: true },
    });
    rerender({ b: false });
    expect(result.current).toBe(true);
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(result.current).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(false);
  });

  it('a sheet that opens again during the wait starts the wait over', () => {
    const { result, rerender } = renderHook(({ b }) => useHeldBack(b, 300), {
      initialProps: { b: true },
    });
    rerender({ b: false });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    rerender({ b: true });
    rerender({ b: false });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current).toBe(true);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current).toBe(false);
  });
});
