/** Bottom tab bar: Today · Month · Requests · Payslips · Me, the bindi on the active tab (PRD 5.1). */
import { type IconName, TabBar, TabBarItem } from '@fs/ui';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';

interface Tab {
  to: string;
  icon: IconName;
  labelKey: 'today' | 'month' | 'requests' | 'payslips' | 'me';
  match: (path: string) => boolean;
}

const TABS: Tab[] = [
  { to: '/', icon: 'clock', labelKey: 'today', match: (p) => p === '/' },
  {
    to: '/month',
    icon: 'calendar-blank',
    labelKey: 'month',
    match: (p) => p.startsWith('/month') || p.startsWith('/day/'),
  },
  {
    to: '/requests',
    icon: 'calendar-check',
    labelKey: 'requests',
    match: (p) => p.startsWith('/requests'),
  },
  {
    to: '/payslips',
    icon: 'currency-inr',
    labelKey: 'payslips',
    match: (p) => p.startsWith('/payslips'),
  },
  { to: '/me', icon: 'user', labelKey: 'me', match: (p) => p.startsWith('/me') },
];

export function StaffTabBar() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const labels = {
    today: t('staff:nav.today'),
    month: t('staff:nav.month'),
    requests: t('staff:nav.requests'),
    payslips: t('staff:nav.payslips'),
    me: t('staff:nav.me'),
  };
  return (
    <TabBar label={t('staff:nav.label')} className="staff-tabbar">
      {TABS.map((tab) => (
        <TabBarItem
          key={tab.to}
          icon={tab.icon}
          label={labels[tab.labelKey]}
          current={tab.match(pathname)}
          asChild
        >
          <Link to={tab.to} />
        </TabBarItem>
      ))}
    </TabBar>
  );
}
