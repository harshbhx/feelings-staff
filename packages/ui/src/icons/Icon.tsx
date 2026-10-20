import type { SVGProps } from 'react';
import { useSyncExternalStore } from 'react';
import { cx } from '../lib/cx';
import { ICON_NAMES, type IconName } from './names';
import { CORE_ICON_PATHS } from './paths-core';
import type { RestIconName } from './paths-rest';

export type { IconName };
export { ICON_NAMES };

type RestPaths = Record<RestIconName, readonly string[]>;

// The staff-core set (./paths-core) covers Today, the tab bar, the header and the shared banners
// (PRD 11.10), so it is the only icon data in the staff initial chunk. Every other icon comes from
// here, fetched the moment this module runs — by the time anything outside the core set first
// renders (always behind its own lazy screen or sheet already), the chunk has almost always landed.
let restPaths: RestPaths | null = null;
let restLoading = false;
const restListeners = new Set<() => void>();

function loadRestPaths(): void {
  if (restLoading) return;
  restLoading = true;
  void import('./paths-rest')
    .then((m) => {
      restPaths = m.REST_ICON_PATHS as unknown as RestPaths;
      for (const l of restListeners) l();
    })
    .catch(() => {
      restLoading = false; // let the next Icon mount try again
    });
}

function subscribeRestPaths(listener: () => void): () => void {
  loadRestPaths();
  restListeners.add(listener);
  return () => restListeners.delete(listener);
}

function getRestPathsSnapshot(): RestPaths | null {
  return restPaths;
}

/** Re-renders once ./paths-rest has loaded, so a non-core icon pops in rather than staying blank. */
function useRestPaths(): RestPaths | null {
  return useSyncExternalStore(subscribeRestPaths, getRestPathsSnapshot, getRestPathsSnapshot);
}

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children' | 'name'> {
  name: IconName;
  /**
   * Give a label only when the icon carries meaning on its own (no visible word next to it).
   * Without one the icon is decorative and hidden from screen readers (PRD 12.7).
   */
  label?: string | undefined;
}

/**
 * One Phosphor regular icon, inline. Sizes follow the text: 1.25em standalone, 1.2em inside a
 * button (set by the button's CSS). Colour is `currentColor`.
 */
export function Icon({ name, label, className, ...rest }: IconProps) {
  const restIcons = useRestPaths();
  const paths =
    (CORE_ICON_PATHS as Partial<Record<IconName, readonly string[]>>)[name] ??
    restIcons?.[name as RestIconName] ??
    [];
  return label ? (
    <svg
      viewBox="0 0 256 256"
      fill="currentColor"
      className={cx('fs-icon', className)}
      role="img"
      aria-label={label}
      {...rest}
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  ) : (
    <svg
      viewBox="0 0 256 256"
      fill="currentColor"
      className={cx('fs-icon', className)}
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
