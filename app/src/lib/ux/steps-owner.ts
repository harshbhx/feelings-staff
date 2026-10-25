import type { TourStep } from './Tour';

export const OWNER_STEPS: readonly TourStep[] = [
  {
    key: 'owner-today',
    title: 'ux:tour.owner.today.title',
    body: 'ux:tour.owner.today.body',
    href: '/o/today',
  },
  {
    key: 'owner-actions',
    title: 'ux:tour.owner.actions.title',
    body: 'ux:tour.owner.actions.body',
    href: '/o/actions',
  },
  {
    key: 'owner-register',
    title: 'ux:tour.owner.register.title',
    body: 'ux:tour.owner.register.body',
    href: '/o/register',
  },
  {
    key: 'owner-staff',
    title: 'ux:tour.owner.staff.title',
    body: 'ux:tour.owner.staff.body',
    href: '/o/staff',
  },
  {
    key: 'owner-more',
    title: 'ux:tour.owner.more.title',
    body: 'ux:tour.owner.more.body',
    href: '/o/more',
  },
];
