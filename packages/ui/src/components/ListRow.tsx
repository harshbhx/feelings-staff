import { Slot } from 'radix-ui';
import type { ComponentProps, HTMLAttributes, ReactNode } from 'react';
import { Icon } from '../icons/Icon';
import { cx } from '../lib/cx';

export interface ListProps extends HTMLAttributes<HTMLUListElement> {
  /** Draw hairlines above the first and below the last row too. */
  framed?: boolean | undefined;
}

/** Hairline-separated rows, not a stack of cards (PRD 12.5, 12.11). Holds `ListRow`s. */
export function List({ framed = false, className, ...rest }: ListProps) {
  return (
    <ul className={cx('fs-list', className)} data-framed={framed ? '' : undefined} {...rest} />
  );
}

export interface ListRowProps extends Omit<ComponentProps<'button'>, 'title'> {
  /** An `Avatar` or an `Icon` at the start. */
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /**
   * Badges under the subtitle ("+28 m", "Inside", "Waiting for you"). They wrap under the name
   * instead of squeezing it, so rows stay one shape on a 390 px phone.
   */
  meta?: ReactNode;
  /** A `StatusChip`, an amount or a time at the end. */
  trailing?: ReactNode;
  /**
   * Render the child element (a router `Link`) as the row, so the whole row is one target.
   * Without `asChild` and without `onClick` the row is static text.
   */
  asChild?: boolean | undefined;
  /** Show the caret on interactive rows (default: shown when the row is a link or button). */
  chevron?: boolean | undefined;
}

/** One row: leading, title and subtitle, trailing; 56 px or taller (PRD 12.6). */
export function ListRow({
  leading,
  title,
  subtitle,
  meta,
  trailing,
  asChild = false,
  chevron,
  className,
  children,
  onClick,
  type,
  ...rest
}: ListRowProps) {
  const interactive = asChild || onClick !== undefined;
  const showChevron = chevron ?? interactive;
  const inner = (
    <>
      {leading ? <span className="fs-row__leading">{leading}</span> : null}
      <span className="fs-row__text">
        <span className="fs-row__title">{title}</span>
        {subtitle ? <span className="fs-row__subtitle">{subtitle}</span> : null}
        {meta ? <span className="fs-row__meta">{meta}</span> : null}
      </span>
      {trailing ? <span className="fs-row__trailing">{trailing}</span> : null}
      {showChevron ? <Icon name="caret-right" className="fs-row__chevron" /> : null}
    </>
  );
  if (asChild) {
    return (
      <li className="fs-list__item">
        <Slot.Root className={cx('fs-row', className)} data-interactive="" {...rest}>
          <Slot.Slottable>{children}</Slot.Slottable>
          {inner}
        </Slot.Root>
      </li>
    );
  }
  if (onClick) {
    return (
      <li className="fs-list__item">
        <button
          type={type ?? 'button'}
          className={cx('fs-row', className)}
          data-interactive=""
          onClick={onClick}
          {...rest}
        >
          {inner}
        </button>
      </li>
    );
  }
  return (
    <li className="fs-list__item">
      <div className={cx('fs-row', className)}>{inner}</div>
    </li>
  );
}
