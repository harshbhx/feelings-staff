import { Slot } from 'radix-ui';
import {
  type ComponentProps,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useId,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, type IconName } from '../icons/Icon';
import { cx } from '../lib/cx';

/**
 * Roles (docs/ui-redesign-plan.md 5a): `primary` the one sindoor action of the view; `secondary` a
 * cream pill for common alternatives; `tertiary` (alias `ghost`) a text button for low-stakes
 * actions; `danger-secondary` a destructive action at rest (red label); `danger` the armed last
 * step of a confirm sheet (solid red). Every role has rest, hover, pressed, focus, pending and
 * disabled states in button.css.
 */
export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'ghost'
  | 'danger-secondary'
  | 'danger';
/** `lg` (56 px) is the staff Today hero: the one Check in / Check out (WP-10). */
export type ButtonSize = 'lg' | 'md' | 'sm';

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
  /**
   * Pending: a 16 px ring takes the leading icon's place, `aria-busy`, presses are ignored and the
   * width holds. The label stays (or becomes `loadingLabel`, e.g. "Checking in…"); after 8 s with no
   * answer it reads "Still trying".
   */
  loading?: boolean | undefined;
  loadingLabel?: ReactNode;
  /**
   * Why it cannot be pressed yet ("Check in opens at 09:00"): a line under the button, read with it.
   * The button stays focusable (`aria-disabled`, not `disabled`) so touch and screen readers reach
   * the reason. A primary action is never disabled without one.
   */
  disabledReason?: ReactNode;
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
  disabledReason,
  asChild = false,
  className,
  children,
  type,
  onClick,
  ...rest
}: ButtonProps) {
  const { t } = useTranslation();
  const reasonId = useId();
  const slow = useSlow(loading);
  const Comp = asChild ? Slot.Root : 'button';
  const blocked = loading || !!disabledReason;
  const label = slow
    ? t('ui:button.stillTrying')
    : loading && loadingLabel !== undefined
      ? loadingLabel
      : children;
  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (blocked) {
      e.preventDefault();
      return;
    }
    onClick?.(e);
  };
  const button = (
    <Comp
      type={asChild ? undefined : (type ?? 'button')}
      className={cx('fs-btn', className)}
      data-variant={variant}
      data-size={size}
      data-block={block ? '' : undefined}
      data-icon={icon ? '' : undefined}
      aria-busy={loading || undefined}
      aria-disabled={blocked || undefined}
      aria-describedby={disabledReason ? reasonId : undefined}
      onClick={handleClick}
      {...rest}
    >
      {loading ? <span className="fs-btn__ring" aria-hidden="true" /> : null}
      {icon && !loading ? <Icon name={icon} /> : null}
      {asChild ? <Slot.Slottable>{children}</Slot.Slottable> : label}
      {iconEnd ? <Icon name={iconEnd} /> : null}
    </Comp>
  );
  if (!disabledReason) return button;
  return (
    <>
      {button}
      <span id={reasonId} className="fs-btn__reason">
        {disabledReason}
      </span>
    </>
  );
}

/** True once a pending press has had no answer for 8 s (the "Still trying" label). */
function useSlow(loading: boolean): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (!loading) return;
    const id = setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(id);
  }, [loading]);
  return loading && slow;
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
