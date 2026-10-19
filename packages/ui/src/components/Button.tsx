import { Slot } from 'radix-ui';
import type { ComponentProps, MouseEvent, ReactNode } from 'react';
import { Icon, type IconName } from '../icons/Icon';
import { cx } from '../lib/cx';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger-secondary';
export type ButtonSize = 'md' | 'sm';

export interface ButtonProps extends ComponentProps<'button'> {
  /**
   * `primary` is the one sindoor action of the view (PRD 12.2). Everything else is `secondary`,
   * `ghost`, or `danger-secondary` (a destructive action that still needs a confirm step).
   */
  variant?: ButtonVariant | undefined;
  /** `md` is 48 px, `sm` 40 px (its tap target still reaches 44 px). */
  size?: ButtonSize | undefined;
  icon?: IconName | undefined;
  iconEnd?: IconName | undefined;
  /** Full width (stacked buttons on phones). */
  block?: boolean | undefined;
  /** Submitting: the label changes (`loadingLabel`, e.g. "Checking in…") and presses are ignored. */
  loading?: boolean | undefined;
  loadingLabel?: ReactNode;
  /** Render the child element (a link) with the button's look instead of a `<button>`. */
  asChild?: boolean | undefined;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  iconEnd,
  block,
  loading = false,
  loadingLabel,
  asChild = false,
  className,
  children,
  type,
  onClick,
  ...rest
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button';
  const label = loading && loadingLabel !== undefined ? loadingLabel : children;
  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (loading) {
      e.preventDefault();
      return;
    }
    onClick?.(e);
  };
  return (
    <Comp
      type={asChild ? undefined : (type ?? 'button')}
      className={cx('fs-btn', className)}
      data-variant={variant}
      data-size={size}
      data-block={block ? '' : undefined}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      onClick={handleClick}
      {...rest}
    >
      {icon ? <Icon name={icon} /> : null}
      {asChild ? <Slot.Slottable>{children}</Slot.Slottable> : label}
      {iconEnd ? <Icon name={iconEnd} /> : null}
    </Comp>
  );
}

export interface IconButtonProps extends Omit<ComponentProps<'button'>, 'children' | 'aria-label'> {
  icon: IconName;
  /** What the button does, read by screen readers ("Close", "Notifications, 3 new"). Required. */
  label: string;
  /** `ghost` (default) has no outline; `outline` draws a control-strength ring (steppers). */
  variant?: 'ghost' | 'outline' | undefined;
  /** A small sindoor dot on the icon, for unread items. Say so in `label` too. */
  dot?: boolean | undefined;
}

/** A 44 px circular button with one icon (PRD 12.6). */
export function IconButton({
  icon,
  label,
  variant = 'ghost',
  dot = false,
  className,
  type,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type ?? 'button'}
      aria-label={label}
      className={cx('fs-icon-btn', className)}
      data-variant={variant}
      {...rest}
    >
      <Icon name={icon} />
      {dot ? <span className="fs-icon-btn__dot" aria-hidden="true" /> : null}
    </button>
  );
}
