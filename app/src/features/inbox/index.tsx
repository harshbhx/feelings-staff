/** Header bell with the unread count (PRD 5, S-15). Owner: WP-8. Kept tiny: it is in every shell header, so the initial bundle; the screen is `./screen`, a lazy chunk. */
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';
import { useRefetchOnPush, useUnreadCount } from './hooks';

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
