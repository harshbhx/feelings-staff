/** Shared inbox screen and header bell (PRD 5, S-15). Owner: WP-8. */
import type { NotificationView } from '@fs/contracts';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router';
import { groupByDay, useInbox, useMarkRead, useRefetchOnPush, useUnreadCount } from './hooks';

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
}: {
  n: NotificationView;
  today: boolean;
  onOpen: (n: NotificationView) => void;
}) {
  const { t } = useTranslation('notify');
  const unread = n.readAt === null;
  return (
    <li className="border-b border-[var(--border)] last:border-b-0">
      <button
        type="button"
        onClick={() => onOpen(n)}
        data-unread={unread}
        className="flex min-h-11 w-full items-start gap-3 px-4 py-3 text-left"
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
    </li>
  );
}

function Group({
  label,
  items,
  today,
  onOpen,
}: {
  label: string;
  items: NotificationView[];
  today: boolean;
  onOpen: (n: NotificationView) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section aria-label={label} className="mb-5">
      <h2 className="px-4 pb-2 text-[length:var(--text-xs)] font-semibold text-[var(--text-muted)]">
        {label}
      </h2>
      <ul className="border-y border-[var(--border)]">
        {items.map((n) => (
          <Row key={n.id} n={n} today={today} onOpen={onOpen} />
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

  return (
    <main className="mx-auto max-w-[30rem] py-4">
      <header className="flex items-center justify-between gap-3 px-4 pb-4">
        <h1 className="text-[length:var(--text-lg)] font-extrabold text-[var(--text)]">
          {t('notify:inbox.title')}
        </h1>
        {unread > 0 ? (
          <button
            type="button"
            onClick={() => markRead.mutate({ all: true })}
            disabled={markRead.isPending}
            className="min-h-11 px-2 text-[length:var(--text-sm)] font-semibold text-[var(--text-body)] underline"
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
          <Group label={t('notify:inbox.today')} items={groups.today} today onOpen={open} />
          <Group
            label={t('notify:inbox.earlier')}
            items={groups.earlier}
            today={false}
            onOpen={open}
          />
          {inbox.hasNextPage ? (
            <div className="px-4">
              <button
                type="button"
                onClick={() => void inbox.fetchNextPage()}
                disabled={inbox.isFetchingNextPage}
                className="min-h-11 w-full border border-[var(--border)] text-[length:var(--text-sm)] font-semibold text-[var(--text)]"
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

/** Header bell with the unread count. Shells render it; the route depends on the area (/o or staff). */
export function InboxBell() {
  const { t } = useTranslation('notify');
  const { pathname } = useLocation();
  const count = useUnreadCount();
  useRefetchOnPush();
  const to = pathname === '/o' || pathname.startsWith('/o/') ? '/o/inbox' : '/inbox';
  const label = count > 0 ? t('inbox.bellUnread', { count }) : t('inbox.bell');
  return (
    <Link
      to={to}
      aria-label={label}
      className="relative inline-flex size-11 items-center justify-center text-[var(--text)]"
    >
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M6 9a6 6 0 1 1 12 0c0 4.5 1.5 6 2 7H4c.5-1 2-2.5 2-7Z" />
        <path d="M10 19a2 2 0 0 0 4 0" />
      </svg>
      {count > 0 ? (
        <span
          data-testid="inbox-bell-count"
          aria-hidden="true"
          className="absolute right-1 top-1 inline-flex min-w-5 items-center justify-center rounded-full bg-[var(--accent)] px-1 text-[length:var(--text-xs)] font-bold leading-5 text-[var(--text-on-deep)]"
        >
          {count > 99 ? '99+' : count}
        </span>
      ) : null}
    </Link>
  );
}
