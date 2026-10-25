import type { TourStep } from './Tour';

export const STAFF_STEPS: readonly TourStep[] = [
  { key: 'common:ux.tour.staff.today', href: '/' },
  { key: 'common:ux.tour.staff.month', href: '/month' },
  { key: 'common:ux.tour.staff.requests', href: '/requests' },
  { key: 'common:ux.tour.staff.payslips', href: '/payslips' },
  { key: 'common:ux.tour.staff.me', href: '/me' },
];
