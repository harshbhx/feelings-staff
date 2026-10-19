import type { SVGProps } from 'react';
import { cx } from '../lib/cx';
import { ICON_PATHS, type IconName } from './paths';

export type { IconName };
export const ICON_NAMES = Object.keys(ICON_PATHS) as IconName[];

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
  const paths = ICON_PATHS[name];
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
