/**
 * API provider (WP-1): one ApiClient for the app plus TanStack Query.
 *
 * Mock mode (MockApiClient over packages/contracts/fixtures) is used when:
 * - the build sets VITE_API_MODE=mock, or
 * - the page runs on localhost (CI E2E, never production) with `?mock=1` in the URL. Variants:
 *   `?mock=1&variant=meToday:checked-in,ownerToday:holiday`. The choice sticks for the tab.
 * The mock module is loaded lazily, so it never adds to the initial bundle.
 * Screens call `useApi()` and query hooks; they never call fetch directly.
 */
import type { ApiClient, EndpointKey } from '@fs/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext, useState } from 'react';
import { createHttpApiClient } from './http-client';

const ApiContext = createContext<ApiClient | null>(null);

export const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? '0.0.0';
const MOCK_KEY = 'fs.mock';

interface MockChoice {
  variants: Partial<Record<EndpointKey, string>>;
}

/** Decide whether this tab runs on fixtures (see header comment). */
export function mockChoice(): MockChoice | null {
  if (import.meta.env.VITE_API_MODE === 'mock') return { variants: {} };
  if (typeof window === 'undefined') return null;
  const host = window.location.hostname;
  if (host !== 'localhost' && host !== '127.0.0.1') return null;
  const params = new URLSearchParams(window.location.search);
  try {
    if (params.get('mock') === '1') {
      const variants: Record<string, string> = {};
      for (const pair of (params.get('variant') ?? '').split(',').filter(Boolean)) {
        const [k, v] = pair.split(':');
        if (k && v) variants[k] = v;
      }
      sessionStorage.setItem(MOCK_KEY, JSON.stringify({ variants }));
    }
    const saved = sessionStorage.getItem(MOCK_KEY);
    return saved ? (JSON.parse(saved) as MockChoice) : null;
  } catch {
    return null;
  }
}

/** A client whose methods load the mock module on first use. */
function lazyMockClient(choice: MockChoice): ApiClient {
  const ready = import('@fs/contracts/mock').then((m) =>
    m.createMockApiClient({ latencyMs: 120, variants: choice.variants }),
  );
  return new Proxy({} as ApiClient, {
    get(_t, prop: string) {
      if (prop === 'url') return (key: EndpointKey) => `/api/v1/__mock/${key}`;
      return async (...args: unknown[]) => {
        const client = (await ready) as unknown as Record<string, (...a: unknown[]) => unknown>;
        const fn = client[prop];
        if (!fn) throw new Error(`Unknown endpoint ${prop}`);
        return fn(...args);
      };
    },
  });
}

export function createAppClient(): ApiClient {
  const mock = mockChoice();
  if (mock) return lazyMockClient(mock);
  return createHttpApiClient({
    appVersion: APP_VERSION,
    onUpgradeRequired: () => window.dispatchEvent(new CustomEvent('fs:upgrade-required')),
    onAuthLost: () => window.dispatchEvent(new CustomEvent('fs:auth-lost')),
  });
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: true },
      mutations: { retry: 0 },
    },
  });
}

export function ApiProvider({ client, children }: { client?: ApiClient; children: ReactNode }) {
  const [api] = useState(() => client ?? createAppClient());
  const [queryClient] = useState(createQueryClient);
  return (
    <ApiContext.Provider value={api}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ApiContext.Provider>
  );
}

export function useApi(): ApiClient {
  const api = useContext(ApiContext);
  if (!api) throw new Error('useApi outside ApiProvider');
  return api;
}
