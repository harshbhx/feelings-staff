/**
 * Owner shell (PRD 5.2, 12.5). Phones: sticky glass header (title + bell), banners, content, and the
 * bottom tab bar Today · Needs action · Register · Staff · More with the count on Needs action.
 * From 64rem: a 15rem left rail with every item (the bindi marks the active one) and the content up
 * to 76rem. Also: the step-up PIN sheet, push refetch, the app badge and the toast region.
 * Brand (UI redesign slice 1): the page is the warm band; the logo leads the phone header on Today
 * (the title stays the h1 for assistive tech) and tops the rail; tab-level titles end with the bindi.
 */

import {
  Avatar,
  Banner,
  Bindi,
  Button,
  IconButton,
  Logo,
  RailGroup,
  RailItem,
  RailNav,
  TabBar,
  TabBarItem,
  ToastProvider,
} from '@fs/ui';
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
import {
  activeItem,
  activeTab,
  allowed,
  MORE,
  MORE_TAB,
  type NavItem,
  RAIL_GROUPS,
  TABS,
} from './nav';

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
            className="min-h-dvh bg-(--app-page) [--owner-toast-offset:var(--tabbar-h)] xl:pl-(--owner-rail-w) xl:[--owner-toast-offset:0px]"
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
  const { pathname } = useLocation();
  const { title, titleKey, back } = useScreenChrome();
  // Today on a phone: the logo leads and the title is read, not shown (the rail has the logo on desktop).
  const home = pathname === '/o/today';
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
        {home ? (
          <Logo name={t('common:app.shortName')} className="mr-auto ml-0.5 xl:hidden" />
        ) : null}
        <h1
          className={`line-clamp-2 min-w-0 flex-1 text-balance font-extrabold text-text text-xl leading-snug tracking-display${home ? ' max-xl:sr-only' : ''}`}
          data-testid="owner-title"
        >
          {/* "Neha Parmar · Mon, 19 Oct": the dot stays on the first line when the title wraps. */}
          {(title ?? t(titleKey)).replaceAll(' · ', '\u00a0· ')}
          {/* Tab-level screens end their title with the bindi on phones (PRD 12.4, 12.9). */}
          {back ? null : <Bindi className="xl:hidden" />}
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
            label={t(item.tabLabelKey ?? item.labelKey)}
            current={active === item.key}
            badge={item.key === 'actions' && count > 0 ? count : undefined}
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
  const item = (i: NavItem) => (
    <RailItem
      key={i.key}
      asChild
      icon={i.icon}
      label={t(i.labelKey)}
      current={active === i.key}
      badge={i.key === 'actions' && count > 0 ? count : undefined}
    >
      <Link to={i.to} />
    </RailItem>
  );
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-(--owner-rail-w) flex-col border-border border-r bg-bg xl:flex">
      <div className="flex h-16 items-center px-6">
        <Logo name={t('common:app.shortName')} size="lg" />
      </div>
      <RailNav label={t('owner:nav.label')} className="flex-1 overflow-y-auto px-3 pt-1 pb-2">
        <RailGroup>{tabs.map(item)}</RailGroup>
        {RAIL_GROUPS.map((g) => {
          const items = more.filter((i) => i.group === g);
          return items.length > 0 ? (
            <RailGroup key={g} label={t(`owner:more.groups.${g}`)}>
              {items.map(item)}
            </RailGroup>
          ) : null;
        })}
      </RailNav>
      {me ? (
        <div className="flex items-center gap-3 border-border border-t px-5 py-3">
          <Avatar name={me.user.name} size="sm" />
          <div className="min-w-0">
            <p className="truncate font-bold text-sm text-text">{me.user.name}</p>
            <p className="truncate text-text-muted text-xs">{me.org.name}</p>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
