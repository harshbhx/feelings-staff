/**
 * MockApiClient (PRD 16.1 rule 3): implements ApiClient from fixtures, so UI packages build before
 * the API lands. Switching to the real client is a one-line provider change in app/src/api.
 */
import { fixtures, variants } from '../../fixtures';
import { type ApiClient, ApiError, type CallOptions } from '../client';
import { buildPath, type EndpointShape } from '../endpoint';
import { ENDPOINT_KEYS, type EndpointKey, endpoints } from '../endpoints';

export interface MockOptions {
  /** Pick a named variant per endpoint, e.g. `{ meToday: 'checked-in' }`. */
  variants?: Partial<Record<EndpointKey, string>>;
  /** Replace responses (function receives the call input). */
  overrides?: Partial<Record<EndpointKey, unknown | ((input: unknown) => unknown)>>;
  /** Simulated latency in ms (default 0). */
  latencyMs?: number;
  /** Called on every call, for assertions in tests. */
  onCall?: (key: EndpointKey, input: unknown) => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createMockApiClient(opts: MockOptions = {}): ApiClient {
  const client: Record<string, unknown> = {};
  for (const key of ENDPOINT_KEYS) {
    const def = endpoints[key] as EndpointShape;
    client[key] = async (input?: unknown, _callOpts?: CallOptions) => {
      opts.onCall?.(key, input);
      if (opts.latencyMs) await sleep(opts.latencyMs);
      const override = opts.overrides?.[key];
      if (override !== undefined)
        return typeof override === 'function'
          ? (override as (i: unknown) => unknown)(input)
          : override;
      const variantName = opts.variants?.[key];
      const value = variantName ? variants[key]?.[variantName] : fixtures[key];
      if (value === undefined) {
        if (def.binary) return new Blob(['mock'], { type: 'application/octet-stream' });
        if (def.status === 204 || def.status === 202) return undefined;
        throw new ApiError({
          code: 'NOT_IMPLEMENTED',
          status: 501,
          message: `No fixture for ${key}`,
        });
      }
      return structuredClone(value);
    };
  }
  client.url = (key: EndpointKey, input?: { params?: Record<string, string> }) =>
    `/api/v1${buildPath(endpoints[key].path, input?.params)}`;
  return client as unknown as ApiClient;
}
