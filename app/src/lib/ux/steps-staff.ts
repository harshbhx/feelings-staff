import type { TourStep } from './Tour';

export const STAFF_STEPS: readonly TourStep[] = [
  {
    key: 'staff-today',
    title: 'common:ux.tour.staff.today.title',
    body: 'common:ux.tour.staff.today.body',
    href: '/',
  },
  {
    key: 'staff-month',
    title: 'common:ux.tour.staff.month.title',
    body: 'common:ux.tour.staff.month.body',
    href: '/month',
  },
  {
    key: 'staff-requests',
    title: 'common:ux.tour.staff.requests.title',
    body: 'common:ux.tour.staff.requests.body',
    href: '/requests',
  },
  {
    key: 'staff-payslips',
    title: 'common:ux.tour.staff.payslips.title',
    body: 'common:ux.tour.staff.payslips.body',
    href: '/payslips',
  },
  {
    key: 'staff-me',
    title: 'common:ux.tour.staff.me.title',
    body: 'common:ux.tour.staff.me.body',
    href: '/me',
  },
];
