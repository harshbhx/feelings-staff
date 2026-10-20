/**
 * Owner navigation (PRD 5.2): phone tabs Today · Needs action · Register · Staff · More; More holds
 * Payroll, Credits (owner only), Advances, Reports, Roster, Inbox, Show door code, Settings. The desktop rail lists all.
 * Managers see only what their permissions allow (PRD 10.2).
 */
import type { Me, Permission } from '@fs/contracts';
import type { IconName } from '@fs/ui';

export type NavIcon = IconName;

export interface NavItem {
  key: string;
  to: string;
  labelKey: string;
  /** A one-word label for the phone tab bar ("Actions"), so no label wraps (WP-10). */
  tabLabelKey?: string;
  icon: NavIcon;
  /** Manager permission needed; the owner always passes. `owner` = owner only. */
  needs?: Permission | 'owner';
  /** Where it sits in More on phones. */
  group?: 'money' | 'people' | 'salon';
  hintKey?: string;
}

export const TABS: readonly NavItem[] = [
  { key: 'today', to: '/o/today', labelKey: 'owner:nav.today', icon: 'calendar-check' },
  {
    key: 'actions',
    to: '/o/actions',
    labelKey: 'owner:nav.actions',
    tabLabelKey: 'owner:nav.actionsShort',
    icon: 'warning-circle',
  },
  {
    key: 'register',
    to: '/o/register',
    labelKey: 'owner:nav.register',
    icon: 'calendar-blank',
  },
  { key: 'staff', to: '/o/staff', labelKey: 'owner:nav.staff', icon: 'users', needs: 'staff' },
];

export const MORE: readonly NavItem[] = [
  {
    key: 'payroll',
    to: '/o/payroll',
    labelKey: 'owner:nav.payroll',
    icon: 'currency-inr',
    needs: 'payroll',
    group: 'money',
    hintKey: 'owner:more.hints.payroll',
  },
  {
    // Time credits are owner only (PRD 7.17.9): managers never see the item.
    key: 'credits',
    to: '/o/credits',
    labelKey: 'owner:nav.credits',
    icon: 'hourglass',
    needs: 'owner',
    group: 'money',
    hintKey: 'owner:more.hints.credits',
  },
  {
    key: 'advances',
    to: '/o/advances',
    labelKey: 'owner:nav.advances',
    icon: 'hand-coins',
    needs: 'payroll',
    group: 'money',
    hintKey: 'owner:more.hints.advances',
  },
  {
    key: 'reports',
    to: '/o/reports',
    labelKey: 'owner:nav.reports',
    icon: 'chart-bar',
    needs: 'exports',
    group: 'money',
    hintKey: 'owner:more.hints.reports',
  },
  {
    key: 'roster',
    to: '/o/roster',
    labelKey: 'owner:nav.roster',
    icon: 'clock',
    needs: 'roster',
    group: 'people',
    hintKey: 'owner:more.hints.roster',
  },
  {
    key: 'inbox',
    to: '/o/inbox',
    labelKey: 'owner:nav.inbox',
    icon: 'bell',
    group: 'people',
    hintKey: 'owner:more.hints.inbox',
  },
  {
    key: 'door',
    to: '/o/door-code',
    labelKey: 'owner:nav.doorCode',
    icon: 'qr-code',
    needs: 'door',
    group: 'salon',
    hintKey: 'owner:more.hints.doorCode',
  },
  {
    key: 'settings',
    to: '/o/settings',
    labelKey: 'owner:nav.settings',
    icon: 'gear',
    needs: 'owner',
    group: 'salon',
    hintKey: 'owner:more.hints.settings',
  },
];

export const MORE_TAB: NavItem = {
  key: 'more',
  to: '/o/more',
  labelKey: 'owner:nav.more',
  icon: 'dots-three',
};

export function allowed(item: NavItem, me: Me | null | undefined): boolean {
  if (!me) return false;
  if (me.user.role === 'owner') return true;
  if (!item.needs) return true;
  if (item.needs === 'owner') return false;
  return me.permissions.includes(item.needs);
}

/** Rail groups on desktop, in order: the four tabs first (no heading), then More's groups. */
export const RAIL_GROUPS = ['money', 'people', 'salon'] as const;

/** Which tab is active for a path (More is active for everything that lives in More). */
export function activeTab(pathname: string): string {
  for (const tab of TABS)
    if (pathname === tab.to || pathname.startsWith(`${tab.to}/`)) return tab.key;
  if (pathname.startsWith('/o/setup')) return 'today';
  return 'more';
}

/** Which rail item is active (desktop shows every item). */
export function activeItem(pathname: string): string {
  for (const item of [...TABS, ...MORE])
    if (pathname === item.to || pathname.startsWith(`${item.to}/`)) return item.key;
  if (pathname.startsWith('/o/duties')) return 'roster';
  return activeTab(pathname);
}
