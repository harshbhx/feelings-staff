import type { TourStep } from './Tour';

export const OWNER_STEPS: readonly TourStep[] = [
  {
    key: 'owner-today',
    title: 'common:ux.tour.owner.today.title',
    body: 'common:ux.tour.owner.today.body',
    href: '/o/today',
  },
  {
    key: 'owner-actions',
    title: 'common:ux.tour.owner.actions.title',
    body: 'common:ux.tour.owner.actions.body',
    href: '/o/actions',
  },
  {
    key: 'owner-register',
    title: 'common:ux.tour.owner.register.title',
    body: 'common:ux.tour.owner.register.body',
    href: '/o/register',
  },
  {
    key: 'owner-staff',
    title: 'common:ux.tour.owner.staff.title',
    body: 'common:ux.tour.owner.staff.body',
    href: '/o/staff',
  },
  {
    key: 'owner-more',
    title: 'common:ux.tour.owner.more.title',
    body: 'common:ux.tour.owner.more.body',
    href: '/o/more',
  },
];
