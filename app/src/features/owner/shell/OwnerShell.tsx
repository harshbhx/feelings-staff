/**
 * Owner shell (PRD 5.2, 12.5). Phones: sticky glass header (title + bell), banners, content, and the
 * bottom tab bar Today · Needs action · Register · Staff · More with the count on Needs action.
 * From 64rem: a 15rem left rail with every item (the bindi marks the active one) and the content up
 * to 76rem. Also: the step-up PIN sheet, push refetch, the app badge and the toast region.
 */

import { Banner, Bindi, Button, IconButton, TabBar, TabBarItem, ToastProvider } from '@fs/ui';
import { useQueryClient } from '@tanstack/react-query';
import { type CSSProperties, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import { useMe } from '../../../api/hooks';
import { StepUpProvider } from '../../auth/step-up';
import { InboxBell } from '../../inbox';
import { openActionCount } from '../actions/actions-model';
import { useActions } from '../api/attendance';
import { ownerKeys } from '../api/keys';
import { clock } from '../lib/format';
import { ChromeProvider, useScreenChrome } from './chrome';
import {
  iosBannerSeen,
  isIosBrowserTab,
  markIosBannerSeen,
  useAppBadge,
  useOnline,
  usePushRefetch,
} from './hooks';
import { activeItem, activeTab, allowed, MORE, MORE_TAB, type NavItem, TABS } from './nav';

const SHELL_VARS = {
  '--owner-rail-w': '15rem',
} as CSSProperties;

export function OwnerShell() {
  const actions = useActions();
  const count = actions.data ? openActionCount(actions.data) : null;
  usePushRefetch();
  useAppBadge(count);
  return (
    <ToastProvider bottomOffset="var(--owner-toast-offset)">
      <StepUpProvider>
        <ChromeProvider>
          <div
            style={SHELL_VARS}
            className="min-h-dvh bg-bg [--owner-toast-offset:var(--tabbar-h)] xl:pl-(--owner-rail-w) xl:[--owner-toast-offset:0px]"
          >
            <a
              href="#owner-main"
              className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-sm focus:bg-bg focus:px-4 focus:py-2"
            >
              <SkipLabel />
            </a>
            <Rail count={count ?? 0} />
            <Header />
            <Banners />
            <main
              id="owner-main"
              tabIndex={-1}
              className="mx-auto w-full max-w-(--container-page) px-(--gutter) pt-5 pb-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+2.5rem)] outline-none xl:pt-6 xl:pb-16"
            >
              <Outlet />
            </main>
            <Tabs count={count ?? 0} />
          </div>
        </ChromeProvider>
      </StepUpProvider>
    </ToastProvider>
  );
}

function SkipLabel() {
  const { t } = useTranslation();
  return <>{t('owner:shell.skip')}</>;
}

function Header() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { title, titleKey, back } = useScreenChrome();
  return (
    <header className="sticky top-0 z-30 border-border border-b bg-(--bg-glass) backdrop-blur-[10px]">
      <div className="mx-auto flex h-16 w-full max-w-(--container-page) items-center gap-2 px-(--gutter)">
        {back ? (
          <IconButton
            icon="caret-left"
            label={t('owner:shell.back')}
            onClick={() => navigate(back)}
            className="-ml-3"
          />
        ) : null}
        <h1
          className="min-w-0 flex-1 truncate font-extrabold text-text text-xl tracking-display"
          data-testid="owner-title"
        >
          {title ?? t(titleKey)}
        </h1>
        <InboxBell />
      </div>
    </header>
  );
}

function Banners() {
  const { t } = useTranslation();
  const online = useOnline();
  const qc = useQueryClient();
  const me = useMe();
  const { pathname } = useLocation();
  const [iosHidden, setIosHidden] = useState(() => iosBannerSeen() || !isIosBrowserTab());

  let lastUpdate = 0;
  if (!online) {
    for (const q of qc.getQueryCache().findAll({ queryKey: ownerKeys.all }))
      lastUpdate = Math.max(lastUpdate, q.state.dataUpdatedAt);
  }

  const showSetup = me.data?.flags.setupIncomplete === true && !pathname.startsWith('/o/setup');

  return (
    <div className="mx-auto w-full max-w-(--container-page)">
      {!online ? (
        <Banner icon="wifi-slash" live data-testid="owner-offline">
          {lastUpdate > 0
            ? t('owner:shell.offline', { time: clock(lastUpdate) })
            : t('owner:shell.offlineNoData')}
        </Banner>
      ) : null}
      {!iosHidden ? (
        <Banner
          icon="bell"
          action={
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                markIosBannerSeen();
                setIosHidden(true);
              }}
            >
              {t('owner:shell.dismiss')}
            </Button>
          }
        >
          {t('owner:shell.iosBanner')} {t('owner:shell.iosBannerHow')}
        </Banner>
      ) : null}
      {showSetup ? (
        <Banner
          icon="gear"
          tone="plain"
          action={
            <Button asChild size="sm" variant="secondary">
              <Link to="/o/setup">{t('owner:shell.setupBannerAction')}</Link>
            </Button>
          }
        >
          {t('owner:shell.setupBanner')}
        </Banner>
      ) : null}
    </div>
  );
}

function useNavItems() {
  const me = useMe();
  const tabs = TABS.filter((i) => allowed(i, me.data));
  const more = MORE.filter((i) => allowed(i, me.data));
  return { tabs, more, me: me.data };
}

function Tabs({ count }: { count: number }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { tabs } = useNavItems();
  const active = activeTab(pathname);
  const items: NavItem[] = [...tabs, MORE_TAB];
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 xl:hidden">
      <TabBar label={t('owner:nav.label')}>
        {items.map((item) => (
          <TabBarItem
            key={item.key}
            asChild
            icon={item.icon}
            label={t(item.labelKey)}
            current={active === item.key}
            badge={item.key === 'actions' && count > 0 ? count : undefined}
            aria-label={
              item.key === 'actions' && count > 0
                ? `${t(item.labelKey)}, ${t('owner:nav.openItems', { count })}`
                : undefined
            }
          >
            <Link to={item.to} />
          </TabBarItem>
        ))}
      </TabBar>
    </div>
  );
}

function Rail({ count }: { count: number }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { tabs, more, me } = useNavItems();
  const active = activeItem(pathname);
  const items = [...tabs, ...more];
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-(--owner-rail-w) flex-col border-border border-r bg-bg xl:flex">
      <div className="flex h-16 items-center gap-1 px-6">
        <span className="font-extrabold text-maroon-800 text-xl tracking-display">
          {t('common:app.shortName')}
        </span>
        <Bindi size="heading" className="text-xl" />
      </div>
      <nav aria-label={t('owner:nav.label')} className="flex-1 overflow-y-auto px-3 py-2">
        <ul className="grid gap-0.5">
          {items.map((item) => {
            const current = active === item.key;
            return (
              <li key={item.key}>
                <Link
                  to={item.to}
                  aria-current={current ? 'page' : undefined}
                  className={`relative flex min-h-11 items-center gap-3 rounded-md py-2 pr-3 pl-6 font-semibold text-sm transition-colors hover:bg-bg-soft ${current ? 'text-text' : 'text-text-muted'}`}
                >
                  {current ? (
                    <Bindi size="marker" className="-translate-y-1/2 absolute top-1/2 left-2" />
                  ) : null}
                  <span className="flex-1">{t(item.labelKey)}</span>
                  {item.key === 'actions' && count > 0 ? (
                    <span className="min-w-6 rounded-full bg-bg-tint px-2 text-center font-bold text-maroon-800 text-xs tabular-nums leading-6">
                      {count}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      {me ? (
        <div className="border-border border-t px-6 py-4">
          <p className="truncate font-bold text-sm text-text">{me.user.name}</p>
          <p className="truncate text-text-muted text-xs">{me.org.name}</p>
        </div>
      ) : null}
    </aside>
  );
}
