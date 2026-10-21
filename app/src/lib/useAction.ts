/**
 * One hook for every press that changes something (docs/ui-redesign-plan.md 5a, "Feedback on
 * every action"): press, pending, result, the same everywhere.
 *
 * - Pending: `pending` is true from the press until the answer; a second press while pending is
 *   ignored (the idempotency key on the API covers a retry, this covers the double tap).
 * - Slow: after 8 s without an answer `slow` turns true, so the control can say "Still trying" and
 *   offer Cancel where the action is cancellable (`cancel()` aborts the signal).
 * - Optimistic: only for reversible changes (toggles, marks, routine approvals), and only when the
 *   caller passes `optimistic`. It is off by default; money, check-ins and anything behind the PIN
 *   never pass it: they wait for the server and show the ring.
 * - Failure: the optimistic change is rolled back, `error` is set and `onError` runs; the caller
 *   keeps the person's input and names the reason in place.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export const SLOW_AFTER_MS = 8000;

export interface ActionOptions<A extends unknown[], R> {
  /**
   * Apply the result at once and return how to undo it. Reversible changes only; never for money,
   * check-ins or PIN-gated actions (the default is not optimistic).
   */
  optimistic?: ((...args: A) => () => void) | undefined;
  onSuccess?: ((result: R, ...args: A) => void) | undefined;
  onError?: ((error: unknown, ...args: A) => void) | undefined;
}

export interface ActionState<A extends unknown[], R> {
  /** Start the action. Resolves with the result, or `undefined` when ignored, cancelled or failed. */
  run: (...args: A) => Promise<R | undefined>;
  /** Abort the action in flight (its function receives the signal). */
  cancel: () => void;
  pending: boolean;
  /** No answer after 8 s: say "Still trying", offer Cancel where it makes sense. */
  slow: boolean;
  error: unknown;
}

export function useAction<A extends unknown[], R>(
  fn: (signal: AbortSignal, ...args: A) => Promise<R>,
  options: ActionOptions<A, R> = {},
): ActionState<A, R> {
  const [pending, setPending] = useState(false);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const busy = useRef<AbortController | null>(null);
  const live = useRef(true);
  const latest = useRef({ fn, options });
  latest.current = { fn, options };

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const run = useCallback(async (...args: A): Promise<R | undefined> => {
    if (busy.current) return undefined;
    const ctrl = new AbortController();
    busy.current = ctrl;
    const { fn: call, options: opts } = latest.current;
    setPending(true);
    setSlow(false);
    setError(null);
    const rollback = opts.optimistic?.(...args);
    const timer = setTimeout(() => {
      if (live.current && busy.current === ctrl) setSlow(true);
    }, SLOW_AFTER_MS);
    try {
      const result = await call(ctrl.signal, ...args);
      if (ctrl.signal.aborted) {
        rollback?.();
        return undefined;
      }
      opts.onSuccess?.(result, ...args);
      return result;
    } catch (e) {
      rollback?.();
      if (!ctrl.signal.aborted) {
        if (live.current) setError(e);
        opts.onError?.(e, ...args);
      }
      return undefined;
    } finally {
      clearTimeout(timer);
      // A cancelled run has already handed the control back; never clear a newer run's state.
      if (busy.current === ctrl) {
        busy.current = null;
        if (live.current) {
          setPending(false);
          setSlow(false);
        }
      }
    }
  }, []);

  const cancel = useCallback(() => {
    const ctrl = busy.current;
    if (!ctrl) return;
    ctrl.abort();
    busy.current = null;
    setPending(false);
    setSlow(false);
  }, []);

  return { run, cancel, pending, slow, error };
}
