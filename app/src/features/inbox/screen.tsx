/** Shared inbox screen (PRD 5, S-15). Owner: WP-8. Lazy chunk: the header bell lives in ./index. */
import type { NotificationView } from '@fs/contracts';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { SwipeRow } from '../../lib/swipe-row';
import { groupByDay, useInbox, useMarkRead, useRefetchOnPush } from './hooks';

const IST = 'Asia/Kolkata';

function formatWhen(ts: number, today: boolean): string {
  const opts: Intl.DateTimeFormatOptions = today
    ? { hour: 'numeric', minute: '2-digit', timeZone: IST }
    : { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: IST };
  return new Intl.DateTimeFormat('en-IN', opts).format(ts);
}

function Row({
  n,
  today,
  onOpen,
  onRead,
}: {
  n: NotificationView;
  today: boolean;
  onOpen: (n: NotificationView) => void;
  onRead: (n: NotificationView) => void;
}) {
  const { t } = useTranslation('notify');
  const unread = n.readAt === null;
  return (
    <SwipeRow
      className="border-[var(--border)] border-b last:border-b-0"
      action={unread ? { label: t('inbox.markRead'), onPress: () => onRead(n) } : undefined}
    >
      <button
        type="button"
        onClick={() => onOpen(n)}
        data-unread={unread}
        className="flex min-h-14 w-full items-start gap-3 px-4 py-3 text-left transition-colors active:bg-(--row-press-bg)"
      >
        <span
          className="mt-2 flex size-3 shrink-0 items-center justify-center"
          aria-hidden={!unread}
        >
          {unread ? (
            <>
              <span className="size-2.5 rounded-full bg-[var(--accent)]" />
              <span className="sr-only">{t('inbox.unread')}</span>
            </>
          ) : null}
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={`block text-[length:var(--text-sm)] text-[var(--text)] ${unread ? 'font-bold' : 'font-normal'}`}
          >
            {n.title}
          </span>
          {n.body ? (
            <span className="block text-[length:var(--text-sm)] text-[var(--text-body)]">
              {n.body}
            </span>
          ) : null}
        </span>
        <time
          dateTime={new Date(n.createdAt).toISOString()}
          className="shrink-0 pt-0.5 text-[length:var(--text-xs)] text-[var(--text-muted)]"
        >
          {formatWhen(n.createdAt, today)}
        </time>
      </button>
    </SwipeRow>
  );
}

function Group({
  label,
  items,
  today,
  onOpen,
  onRead,
}: {
  label: string;
  items: NotificationView[];
  today: boolean;
  onOpen: (n: NotificationView) => void;
  onRead: (n: NotificationView) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section aria-label={label} className="mb-5">
      <h2 className="px-4 pb-1.5 font-semibold text-[length:var(--text-xs)] text-[var(--text-muted)]">
        {label}
      </h2>
      <ul className="overflow-hidden rounded-md bg-bg">
        {items.map((n) => (
          <Row key={n.id} n={n} today={today} onOpen={onOpen} onRead={onRead} />
        ))}
      </ul>
    </section>
  );
}

export function InboxScreen() {
  const { t } = useTranslation(['notify', 'common']);
  const navigate = useNavigate();
  const inbox = useInbox();
  const markRead = useMarkRead();
  useRefetchOnPush();

  const items = inbox.data?.pages.flatMap((p) => p.items) ?? [];
  const unread = inbox.data?.pages[0]?.unread ?? 0;
  const groups = groupByDay(items, Date.now());

  const open = (n: NotificationView) => {
    if (n.readAt === null) markRead.mutate({ ids: [n.id] });
    void navigate(n.url);
  };
  const read = (n: NotificationView) => markRead.mutate({ ids: [n.id] });

  return (
    <main className="mx-auto max-w-[30rem] px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+2rem)] in-[#owner-main]:px-0 in-[#owner-main]:pt-0">
      <header className="flex items-end justify-between gap-3 pb-4">
        <h1 className="fs-large-title font-extrabold text-[var(--text)]">
          {t('notify:inbox.title')}
        </h1>
        {unread > 0 ? (
          <button
            type="button"
            onClick={() => markRead.mutate({ all: true })}
            disabled={markRead.isPending}
            className="min-h-11 px-2 font-semibold text-[length:var(--text-base)] text-accent active:opacity-60"
          >
            {t('notify:inbox.markAllRead')}
          </button>
        ) : null}
      </header>

      {inbox.isPending ? (
        <p role="status" className="px-4 text-[length:var(--text-sm)] text-[var(--text-muted)]">
          {t('common:states.loading')}
        </p>
      ) : inbox.isError ? (
        <div role="alert" className="px-4">
          <p className="text-[length:var(--text-sm)] font-semibold text-[var(--text)]">
            {t('notify:inbox.errorTitle')}
          </p>
          <p className="pb-3 text-[length:var(--text-sm)] text-[var(--text-body)]">
            {t('notify:inbox.errorBody')}
          </p>
          <button
            type="button"
            onClick={() => void inbox.refetch()}
            className="min-h-11 text-[length:var(--text-sm)] font-semibold underline"
          >
            {t('common:actions.tryAgain')}
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="px-4 py-8 text-center">
          <p className="text-[length:var(--text-base)] font-semibold text-[var(--text)]">
            {t('notify:inbox.emptyTitle')}
          </p>
          <p className="text-[length:var(--text-sm)] text-[var(--text-body)]">
            {t('notify:inbox.emptyBody')}
          </p>
        </div>
      ) : (
        <>
          <Group
            label={t('notify:inbox.today')}
            items={groups.today}
            today
            onOpen={open}
            onRead={read}
          />
          <Group
            label={t('notify:inbox.earlier')}
            items={groups.earlier}
            today={false}
            onOpen={open}
            onRead={read}
          />
          {inbox.hasNextPage ? (
            <div>
              <button
                type="button"
                onClick={() => void inbox.fetchNextPage()}
                disabled={inbox.isFetchingNextPage}
                className="min-h-11 w-full rounded-full bg-fill font-semibold text-[length:var(--text-sm)] text-[var(--text)] active:bg-(--fill-2)"
              >
                {t('notify:inbox.loadMore')}
              </button>
            </div>
          ) : null}
        </>
      )}
    </main>
  );
}
