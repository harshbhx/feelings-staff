import { Outlet, type RouteObject } from 'react-router';
import { WithNamespaces } from './i18n';

/** A path-less layout route that loads the copy an area needs before it renders. */
export function withNamespaces(
  ns: Parameters<typeof WithNamespaces>[0]['ns'],
  children: RouteObject[],
) {
  return {
    element: (
      <WithNamespaces ns={ns}>
        <Outlet />
      </WithNamespaces>
    ),
    children,
  } satisfies RouteObject;
}
