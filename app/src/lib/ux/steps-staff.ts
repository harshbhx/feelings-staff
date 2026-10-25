import type { TourStep } from './Tour';

export const STAFF_STEPS: readonly TourStep[] = [
  {
    key: 'staff-today',
    title: 'ux:tour.staff.today.title',
    body: 'ux:tour.staff.today.body',
    href: '/',
  },
  {
    key: 'staff-month',
    title: 'ux:tour.staff.month.title',
    body: 'ux:tour.staff.month.body',
    href: '/month',
  },
  {
    key: 'staff-requests',
    title: 'ux:tour.staff.requests.title',
    body: 'ux:tour.staff.requests.body',
    href: '/requests',
  },
  {
    key: 'staff-payslips',
    title: 'ux:tour.staff.payslips.title',
    body: 'ux:tour.staff.payslips.body',
    href: '/payslips',
  },
  {
    key: 'staff-me',
    title: 'ux:tour.staff.me.title',
    body: 'ux:tour.staff.me.body',
    href: '/me',
  },
];
