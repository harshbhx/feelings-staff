/** Inbox queries and mutations (WP-8). TanStack Query over useApi(), like every other feature. */
import { istDate, type NotificationView } from '@fs/contracts';
import {
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect } from 'react';
import { useApi } from '../../api/provider';

export const inboxKey = ['notifications'] as const;
export const inboxListKey = [...inboxKey, 'list'] as const;
export const inboxBellKey = [...inboxKey, 'bell'] as const;

export function useInbox() {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: inboxListKey,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.notificationsList({ query: { cursor: pageParam } }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** Unread count: first page only, refetched on window focus (query default) and on push. */
export function useUnreadCount(): number {
  const api = useApi();
  const q = useQuery({
    queryKey: inboxBellKey,
    queryFn: () => api.notificationsList({}),
    select: (page) => page.unread,
    refetchOnWindowFocus: true,
  });
  return q.data ?? 0;
}

/** Refetch inbox queries when the service worker posts `{type:'push'}` to this page. */
export function useRefetchOnPush(): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const sw = navigator.serviceWorker;
    const onMessage = (e: MessageEvent) => {
      if ((e.data as { type?: string } | null)?.type === 'push') {
        void qc.invalidateQueries({ queryKey: inboxKey });
      }
    };
    sw.addEventListener('message', onMessage);
    return () => sw.removeEventListener('message', onMessage);
  }, [qc]);
}

export function useMarkRead() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { ids: string[] } | { all: true }) =>
      api.notificationsRead({ body: input }),
    onSettled: () => invalidateInbox(qc),
  });
}

export function invalidateInbox(qc: QueryClient) {
  return qc.invalidateQueries({ queryKey: inboxKey });
}

export interface InboxGroups {
  today: NotificationView[];
  earlier: NotificationView[];
}

/** Today / Earlier by IST calendar date. Order within a group is kept (newest first from the API). */
export function groupByDay(items: NotificationView[], now: number): InboxGroups {
  const today = istDate(now);
  const out: InboxGroups = { today: [], earlier: [] };
  for (const n of items) (istDate(n.createdAt) === today ? out.today : out.earlier).push(n);
  return out;
}
