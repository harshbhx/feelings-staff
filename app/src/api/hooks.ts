/** Shared query hooks (WP-1). Feature packages add their own hooks next to their screens. */
import { isApiError, type Me } from '@fs/contracts';
import { useQuery } from '@tanstack/react-query';
import { useApi } from './provider';

export const meQueryKey = ['me'] as const;

/** The signed-in person, or null when signed out. */
export function useMe() {
  const api = useApi();
  return useQuery<Me | null>({
    queryKey: meQueryKey,
    queryFn: async () => {
      try {
        return await api.me();
      } catch (e) {
        if (isApiError(e, 'UNAUTHENTICATED')) return null;
        throw e;
      }
    },
    staleTime: 60_000,
  });
}
