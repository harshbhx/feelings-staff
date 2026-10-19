import { Slot } from 'radix-ui';
import { type ComponentProps, type ReactNode, useId } from 'react';
import { Icon, type IconName } from '../icons/Icon';
import { cx } from '../lib/cx';
import { Bindi } from './Bindi';

export interface RailNavProps {
  /** Names the navigation landmark ("Main"). */
  label: string;
  children: ReactNode;
  className?: string | undefined;
}

/**
 * The owner's desktop left rail (PRD 12.5, WP-10): groups of items with a Phosphor icon, the
 * active one on a blush pill with the bindi. The shell places it; this is only the navigation.
 */
export function RailNav({ label, children, className }: RailNavProps) {
  return (
    <nav aria-label={label} className={cx('fs-rail', className)}>
      {children}
    </nav>
  );
}

export interface RailGroupProps {
  /** A small heading over the group ("Money"). The first group usually has none. */
  label?: string | undefined;
  children: ReactNode;
}

export function RailGroup({ label, children }: RailGroupProps) {
  const id = useId();
  return (
    <div className="fs-rail__group">
      {label ? (
        <p className="fs-rail__label" id={id}>
          {label}
        </p>
      ) : null}
      <ul className="fs-rail__list" aria-labelledby={label ? id : undefined}>
        {children}
      </ul>
    </div>
  );
}

export interface RailItemProps extends Omit<ComponentProps<'a'>, 'children'> {
  icon: IconName;
  label: string;
  /** The item for the screen on show: `aria-current="page"`, the pill and the bindi. */
  current?: boolean | undefined;
  /** A count at the end ("Needs action" 9). */
  badge?: number | string | undefined;
  /** Render the child element (a router `Link`) instead of an `<a>`. */
  asChild?: boolean | undefined;
  children?: ReactNode;
}

export function RailItem({
  icon,
  label,
  current = false,
  badge,
  asChild = false,
  className,
  children,
  ...rest
}: RailItemProps) {
  const inner = (
    <>
      <Bindi size="marker" className="fs-rail-item__bindi" />
      <Icon name={icon} className="fs-rail-item__icon" />
      <span className="fs-rail-item__label">{label}</span>
      {badge !== undefined ? <span className="fs-rail-item__badge">{badge}</span> : null}
    </>
  );
  const common = {
    className: cx('fs-rail-item', className),
    'aria-current': current ? ('page' as const) : undefined,
  };
  return (
    <li>
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
