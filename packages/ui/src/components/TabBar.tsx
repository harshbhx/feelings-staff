import { Slot } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { Icon, type IconName } from '../icons/Icon';
import { cx } from '../lib/cx';
import { Bindi } from './Bindi';

export interface TabBarProps {
  /** Names the navigation landmark ("Main"). */
  label: string;
  children: ReactNode;
  className?: string | undefined;
}

/**
 * The bottom tab bar: up to 5 items, icon + label, the bindi under the active icon (PRD 5, 12.6,
 * 12.9). Glass, hairline on top, padded for the home indicator.
 */
export function TabBar({ label, children, className }: TabBarProps) {
  return (
    <nav aria-label={label} className={cx('fs-tabbar', className)}>
      <ul className="fs-tabbar__list">{children}</ul>
    </nav>
  );
}

export interface TabBarItemProps extends Omit<ComponentProps<'a'>, 'children'> {
  icon: IconName;
  label: string;
  /** The item for the screen on show. Sets `aria-current="page"` and shows the bindi. */
  current?: boolean | undefined;
  /** A count on the icon ("Needs action" 3). The label should still make sense without it. */
  badge?: number | string | undefined;
  /** Render the child element (a router `Link`) instead of an `<a>`. */
  asChild?: boolean | undefined;
  children?: ReactNode;
}

export function TabBarItem({
  icon,
  label,
  current = false,
  badge,
  asChild = false,
  className,
  children,
  ...rest
}: TabBarItemProps) {
  const inner = (
    <>
      <span className="fs-tab__icon">
        <Icon name={icon} />
        {badge !== undefined ? <span className="fs-tab__badge">{badge}</span> : null}
      </span>
      <Bindi size="marker" className="fs-tab__bindi" />
      <span className="fs-tab__label">{label}</span>
    </>
  );
  const common = {
    className: cx('fs-tab', className),
    'aria-current': current ? ('page' as const) : undefined,
  };
  return (
    <li className="fs-tabbar__item">
      {asChild ? (
        <Slot.Root {...common} {...rest}>
          <Slot.Slottable>{children}</Slot.Slottable>
          {inner}
        </Slot.Root>
      ) : (
        <a {...common} {...rest}>
          {inner}
        </a>
      )}
    </li>
  );
}
