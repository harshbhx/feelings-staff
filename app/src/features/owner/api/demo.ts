/**
 * Demo data tools (preview only). The server tells the client what it is through the public
 * config (`env`); the Settings entry and its screen exist only when that says `preview`, and the
 * server answers 404 to the endpoints anywhere else regardless of what the client shows.
 */
import { useQuery } from '@tanstack/react-query';
import { useApi } from '../../../api/provider';

export const configKey = ['config'] as const;

/** `true` only once the server has said `env: "preview"`; false while loading, on error and in production. */
export function useIsPreview(): boolean {
  const api = useApi();
  const q = useQuery({
    queryKey: configKey,
    queryFn: () => api.config(),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  return q.data?.env === 'preview';
}
