/**
 * API provider (WP-1): one ApiClient for the app, real or mock (VITE_API_MODE=mock), plus TanStack Query.
 * Screens call `useApi()` and query hooks; they never call fetch directly.
 */
import type { ApiClient } from '@fs/contracts';
import { createMockApiClient } from '@fs/contracts/mock';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext, useState } from 'react';
import { createHttpApiClient } from './http-client';

const ApiContext = createContext<ApiClient | null>(null);

export const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? '0.0.0';

export function createAppClient(): ApiClient {
  if (import.meta.env.VITE_API_MODE === 'mock') return createMockApiClient({ latencyMs: 150 });
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
