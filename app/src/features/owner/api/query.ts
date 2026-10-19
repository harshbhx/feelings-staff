/**
 * Small helpers shared by the owner query hooks: the mock hold (loading/error frozen for visual
 * tests), and a mutation hook that retries once after the owner PIN when the server asks for
 * step-up (PRD 4.1.7), then invalidates the queries the change affects.
 */
import type { ApiClient, CallOptions, EndpointKey } from '@fs/contracts';
import { type QueryKey, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../../api/provider';
import { useStepUp } from '../../auth/step-up';
import { held, retryUnlessHeld } from './mock-states';

/** Base options for an owner query: key, held query function, retry policy. */
export function ownerQuery<T>(endpoint: EndpointKey, queryKey: QueryKey, fn: () => Promise<T>) {
  return {
    queryKey,
    queryFn: () => held(endpoint, fn),
    retry: retryUnlessHeld(endpoint),
  };
}

export interface OwnerMutationOptions<TVars, TData> {
  /** `call` carries one idempotency key per user intent, reused on the step-up retry. */
  run: (api: ApiClient, vars: TVars, call: CallOptions) => Promise<TData>;
  /** Query keys (prefixes) to refetch after success. */
  invalidate?: (vars: TVars, data: TData) => readonly QueryKey[];
  onSuccess?: (data: TData, vars: TVars) => void;
}

/**
 * A mutation that goes through the step-up runner: if the server answers STEP_UP_REQUIRED the PIN
 * sheet opens and the call is retried with the same idempotency key once the PIN is accepted.
 */
export function useOwnerMutation<TVars, TData>(opts: OwnerMutationOptions<TVars, TData>) {
  const api = useApi();
  const qc = useQueryClient();
  const { run } = useStepUp();
  return useMutation<TData, Error, TVars>({
    mutationFn: (vars) => {
      const call: CallOptions = { idempotencyKey: newIntentKey() };
      return run(() => opts.run(api, vars, call));
    },
    onSuccess: async (data, vars) => {
      opts.onSuccess?.(data, vars);
      const keys = opts.invalidate?.(vars, data) ?? [];
      await Promise.all(keys.map((queryKey) => qc.invalidateQueries({ queryKey })));
    },
  });
}

/** A fresh idempotency key per user intent (a repeat tap reuses it). */
export function newIntentKey(): string {
  return crypto.randomUUID();
}
